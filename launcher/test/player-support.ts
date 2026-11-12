import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  bashExe,
  bashPath,
  git,
  type Launcher,
  makePlayer,
  makeWorld,
  repoRoot,
  run,
  type World,
} from './harness.ts';

// Shared support for the persistent player verbs tests (SC-163a/b, decision 64), both launchers.
// No Docker and no ssh-keygen: a docker stand-in logs every compose call with its environment, and a
// stub for the GELDAR_SSH_KEYGEN seam writes a fixed key pair. Every other docker call goes to the
// shared fake (fake-docker.sh).

export const ID = 'player-test-01';
export const MCP = 'mcp-token-VALUE-0123456789';
export const LOGIN = 'sk-ant-oat01-LOGIN-0123456789abcdef';
export const KEY = 'PRIVATE-KEY-SENTINEL-0123456789';
export const REMOTE = 'ssh://git@ssh.github.com:443/acme/player-one.git';
export const GITHUB = 'https://github.com/acme/player-one.git';
export const PLAYER_YML = bashPath(join(repoRoot, 'image', 'compose', 'player.yml'));
// bash passes the compose file in its own form; pwsh hands docker the Windows path with forward slashes.
export const playerYml = (l: Launcher) =>
  l.name === 'bash'
    ? PLAYER_YML
    : join(repoRoot, 'image', 'compose', 'player.yml').replace(/\\/g, '/');
// Each launcher run is a bash process; the verbs make several docker stand-in calls per run.
export const T = 120_000;
const win = process.platform === 'win32';

// Player roles run their script with /in, /player and /vol mapped to named volumes (a folder under the
// fake root). Only the mount targets used by player.sh are mapped; the script is run by sh -c.
// biome-ignore lint/suspicious/noTemplateCurlyInString: the stub is shell text, its ${...} is not ours
export const DOCKER_STUB = [
  '#!/bin/sh',
  `FAKE=${bashPath(join(repoRoot, 'launcher', 'test', 'fake-docker.sh'))}`,
  'tab=$(printf "\\t")',
  'log_call() {',
  '  line=""',
  '  sep=""',
  '  for a in "$@"; do',
  '    line="$line$sep$a"',
  '    sep=$tab',
  '  done',
  '  printf "%s\\n" "$line" >> "$FAKE_DOCKER_ROOT/calls.log"',
  '}',
  'player_run() {',
  '  vin="" vpl="" vvol=""',
  '  shift',
  '  while [ $# -gt 0 ]; do',
  '    case $1 in',
  '      -v)',
  '        m=$2',
  '        case $m in *:ro | *:rw) m=${m%:*} ;; esac',
  '        dst=${m##*:}',
  '        src=${m%:*}',
  '        case $src in */*) ;; *) src="$FAKE_DOCKER_ROOT/vol/$src"; mkdir -p "$src" ;; esac',
  '        case $dst in /in) vin=$src ;; /player) vpl=$src ;; /vol) vvol=$src ;; esac',
  '        shift 2',
  '        ;;',
  '      --rm | --init | --read-only) shift ;;',
  '      -*) shift 2 ;;',
  '      *) break ;;',
  '    esac',
  '  done',
  '  shift',
  '  script=$(printf "%s" "$3" | VIN="$vin" VPL="$vpl" VVOL="$vvol" perl -pe \'s{/(in|player|vol)\\b}{$1 eq "in" ? $ENV{VIN} : $1 eq "player" ? $ENV{VPL} : $ENV{VVOL}}ge\')',
  '  sh -c "$script"',
  '}',
  'case ${1:-} in',
  '  compose)',
  '    if [ "${2:-}" = version ]; then exec sh "$FAKE" "$@"; fi',
  '    log_call "$@"',
  '    { echo "--call"; env; } >> "$FAKE_DOCKER_ROOT/compose-env.log"',
  '    case " $* " in *" logs "*) cat "$FAKE_DOCKER_ROOT/compose-logs.txt" 2> /dev/null ;; esac',
  '    exit 0',
  '    ;;',
  '  run)',
  '    case " $* " in *geldar.role=player-*) log_call "$@"; player_run "$@"; exit $? ;; esac',
  '    ;;',
  'esac',
  'exec sh "$FAKE" "$@"',
].join('\n');

// A stand-in for ssh-keygen: counts its runs and writes a key pair whose text names the run.
export const KEYGEN_STUB = [
  '#!/bin/sh',
  'n=$(cat "$FAKE_KEYGEN_COUNT" 2> /dev/null || echo 0)',
  'n=$((n + 1))',
  'echo "$n" > "$FAKE_KEYGEN_COUNT"',
  'while [ $# -gt 0 ]; do',
  '  case $1 in',
  '    -f) out=$2; shift ;;',
  '    -C) comment=$2; shift ;;',
  '  esac',
  '  shift',
  'done',
  'printf "%s\\n" "-----BEGIN OPENSSH PRIVATE KEY-----" "STUBPRIVATE$n" > "$out"',
  'printf "ssh-ed25519 AAAAC3STUB%s %s\\n" "$n" "$comment" > "$out.pub"',
].join('\n');

// Whether this launcher can run the tests that pass a double quote in a docker argument: the
// .cmd shims on Windows refuse one by design, so pwsh there cannot run them.
export const canQuote = (l: Launcher) => !(l.name === 'pwsh' && win);

export interface Opts {
  key?: boolean;
  token?: boolean;
  login?: string | false;
  origin?: string;
}

// Grants the current user full control of each path and removes the inherited grants.
function restrictToOwner(paths: string[]) {
  // The Windows whoami by full path: Git's GNU whoami can come first on PATH and has no /user.
  const whoami = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe');
  const who = spawnSync(whoami, ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
  const sid = `*${who.stdout.split('"')[3]}`;
  for (const f of paths) {
    const grant = statSync(f).isDirectory() ? `${sid}:(OI)(CI)F` : `${sid}:F`;
    spawnSync('icacls.exe', [f, '/inheritance:r', '/grant:r', grant]);
  }
}

// Writes a stub as a shell script; on win32 pwsh runs it through a .cmd shim that starts Git's bash.
function stub(dir: string, name: string, body: string, l: Launcher): string {
  const file = join(dir, name);
  writeFileSync(file, `${body}\n`);
  chmodSync(file, 0o755);
  if (l.name !== 'pwsh' || !win) return file;
  const cmd = `${file}.cmd`;
  writeFileSync(cmd, `@"${bashExe ?? 'bash'}" "${bashPath(file)}" %*\r\n`);
  return cmd;
}

export function setup(l: Launcher, opts: Opts = {}) {
  const w = makeWorld();
  const p = makePlayer(w, { id: ID });
  git(p.clone, ['remote', 'set-url', 'origin', opts.origin ?? GITHUB]);
  if (opts.key !== false)
    writeFileSync(join(p.stateDir, 'deploy-key'), `${KEY}\n`, { mode: 0o600 });
  if (opts.token !== false) writeFileSync(join(p.stateDir, 'token'), `${MCP}\n`, { mode: 0o600 });
  if (opts.login !== false) {
    mkdirSync(join(w.state, 'auth'), { recursive: true, mode: 0o700 });
    chmodSync(join(w.state, 'auth'), 0o700);
    const login = opts.login ?? LOGIN;
    writeFileSync(join(w.state, 'auth', 'claude-oauth-token'), `${login}\n`, { mode: 0o600 });
  }
  // The launchers refuse a login, key or state folder that others can read.
  chmodSync(p.stateDir, 0o700);
  // The pwsh launcher on Windows refuses a login or key that others can read: the fixtures restrict
  // their folders and files to the owner, as the real launcher does (temp folders carry extra grants).
  if (win && l.name === 'pwsh') {
    const state = [p.stateDir, join(p.stateDir, 'deploy-key'), join(p.stateDir, 'token')];
    const auth = [join(w.state, 'auth'), join(w.state, 'auth', 'claude-oauth-token')];
    restrictToOwner([...state, ...auth].filter((f) => existsSync(f)));
  }
  const stubs = join(w.root, 'stubs');
  mkdirSync(stubs, { recursive: true });
  const docker = stub(stubs, 'docker-player', DOCKER_STUB, l);
  const keygen = stub(stubs, 'ssh-keygen', KEYGEN_STUB, l);
  // pwsh starts the stubs with native paths; the shell stubs read the bash form of their folders.
  const base = l.name === 'bash' ? w.env : w.envPwsh;
  const env = {
    ...base,
    GELDAR_DOCKER: l.name === 'bash' ? bashPath(docker) : docker,
    GELDAR_SSH_KEYGEN: l.name === 'bash' ? bashPath(keygen) : keygen,
    FAKE_KEYGEN_COUNT: bashPath(join(w.root, 'keygen-count')),
  };
  const go = (...args: string[]) => run(l, args, { env });
  return { w, p, env, go };
}

// A named volume's folder in the fake root (created on demand, as the fake creates it).
export function vol(w: World, name: string): string {
  const d = join(w.dockerRoot, 'vol', name);
  mkdirSync(d, { recursive: true });
  return d;
}

export const composeCalls = (w: World, word: string) =>
  w.calls().filter((c) => c[0] === 'compose' && c.includes(word));

// The environment of each compose call, as the stand-in recorded it (one block per call).
export function composeEnvs(w: World): Record<string, string>[] {
  const path = join(w.dockerRoot, 'compose-env.log');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('--call\n')
    .filter(Boolean)
    .map((block) => {
      const env: Record<string, string> = {};
      for (const line of block.split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
      }
      return env;
    });
}

// No secret in stdout, stderr or a docker argument list. The token and the login may reach a compose
// environment only under their own names; the key text never does.
export function expectClean(w: World, r: { stdout: string; stderr: string }) {
  for (const s of [MCP, LOGIN, KEY]) {
    expect(r.stdout + r.stderr).not.toContain(s);
    for (const c of w.calls()) expect(c.join(' ')).not.toContain(s);
  }
  for (const env of composeEnvs(w)) {
    for (const [name, value] of Object.entries(env)) {
      expect(value).not.toContain(KEY);
      if (value.includes(MCP)) expect(name).toBe('GELDAR_MCP_TOKEN');
      if (value.includes(LOGIN)) expect(name).toBe('CLAUDE_CODE_OAUTH_TOKEN');
    }
  }
}
