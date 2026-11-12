import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  bashPath,
  git,
  launchers,
  makePlayer,
  makeWorld,
  repoRoot,
  run,
  type World,
} from './harness.ts';

// SC-163a part 2: the persistent player verbs (decision 64), bash lane. No Docker and no ssh-keygen:
// a docker stand-in logs every compose call with its environment, and a stub for the GELDAR_SSH_KEYGEN
// seam writes a fixed key pair. Every other docker call goes to the shared fake (fake-docker.sh).

const ID = 'player-test-01';
const MCP = 'mcp-token-VALUE-0123456789';
const LOGIN = 'sk-ant-oat01-LOGIN-0123456789abcdef';
const KEY = 'PRIVATE-KEY-SENTINEL-0123456789';
const REMOTE = 'ssh://git@ssh.github.com:443/acme/player-one.git';
const GITHUB = 'https://github.com/acme/player-one.git';
const PLAYER_YML = bashPath(join(repoRoot, 'image', 'compose', 'player.yml'));
const bash = launchers.find((l) => l.name === 'bash');
// Each launcher run is a bash process; the verbs make several docker stand-in calls per run.
const T = 120_000;

// Player roles run their script with /in, /player and /vol mapped to named volumes (a folder under the
// fake root). Only the mount targets used by player.sh are mapped; the script is run by sh -c.
const DOCKER_STUB = [
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
const KEYGEN_STUB = [
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

interface Opts {
  key?: boolean;
  token?: boolean;
  login?: string | false;
  origin?: string;
}

function setup(opts: Opts = {}) {
  const w = makeWorld();
  const p = makePlayer(w, { id: ID });
  git(p.clone, ['remote', 'set-url', 'origin', opts.origin ?? GITHUB]);
  if (opts.key !== false)
    writeFileSync(join(p.stateDir, 'deploy-key'), `${KEY}\n`, { mode: 0o600 });
  if (opts.token !== false) writeFileSync(join(p.stateDir, 'token'), `${MCP}\n`, { mode: 0o600 });
  if (opts.login !== false) {
    mkdirSync(join(w.state, 'auth'), { recursive: true });
    const login = opts.login ?? LOGIN;
    writeFileSync(join(w.state, 'auth', 'claude-oauth-token'), `${login}\n`, { mode: 0o600 });
  }
  const stubs = join(w.root, 'stubs');
  mkdirSync(stubs, { recursive: true });
  const docker = join(stubs, 'docker-player');
  const keygen = join(stubs, 'ssh-keygen');
  writeFileSync(docker, `${DOCKER_STUB}\n`);
  writeFileSync(keygen, `${KEYGEN_STUB}\n`);
  chmodSync(docker, 0o755);
  chmodSync(keygen, 0o755);
  const env = {
    ...w.env,
    GELDAR_DOCKER: bashPath(docker),
    GELDAR_SSH_KEYGEN: bashPath(keygen),
    FAKE_KEYGEN_COUNT: bashPath(join(w.root, 'keygen-count')),
  };
  const go = (...args: string[]) => run(bash as NonNullable<typeof bash>, args, { env });
  return { w, p, env, go };
}

// A named volume's folder in the fake root (created on demand, as the fake creates it).
function vol(w: World, name: string): string {
  const d = join(w.dockerRoot, 'vol', name);
  mkdirSync(d, { recursive: true });
  return d;
}

const composeCalls = (w: World, word: string) =>
  w.calls().filter((c) => c[0] === 'compose' && c.includes(word));

// The environment of each compose call, as the stand-in recorded it (one block per call).
function composeEnvs(w: World): Record<string, string>[] {
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
function expectClean(w: World, r: { stdout: string; stderr: string }) {
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

if (bash) {
  it('start refuses without a deploy key, a token file or a usable login', { timeout: T }, () => {
    const cases: [Opts, string][] = [
      [{ key: false }, 'has no deploy key yet'],
      [{ token: false }, 'has no MCP token file'],
      [{ login: false }, 'There is no shared Claude login stored'],
      [{ login: 'too-short' }, 'There is no shared Claude login stored'],
    ];
    for (const [opts, text] of cases) {
      const s = setup(opts);
      const r = s.go('start', ID);
      expect(r.status, text).toBe(1);
      expect(r.stderr).toContain(text);
      expect(composeCalls(s.w, 'up')).toEqual([]);
      expect(s.w.calls().filter((c) => c[0] === 'run')).toEqual([]);
    }
  });

  it('start refuses when origin is not github.com', { timeout: T }, () => {
    const s = setup({ origin: 'https://example.com/acme/player-one.git' });
    const r = s.go('start', ID);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not a GitHub repository');
    expect(composeCalls(s.w, 'up')).toEqual([]);
  });

  it('start with every check met runs compose up -d with the key file path, not its text', {
    timeout: T,
  }, () => {
    const s = setup();
    const r = s.go('start', ID);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain(`${ID} is started`);
    // pl_compose builds -p before -f: the order the launcher uses.
    expect(composeCalls(s.w, 'up')).toEqual([
      ['compose', '-p', `geldar-player-${ID}`, '-f', PLAYER_YML, 'up', '-d'],
    ]);
    const [env] = composeEnvs(s.w);
    expect(env?.GELDAR_KEEPER_REMOTE).toBe(REMOTE);
    expect(env?.GELDAR_DEPLOY_KEY_FILE).toBe(bashPath(join(s.p.stateDir, 'deploy-key')));
    expect(env?.GELDAR_MCP_TOKEN).toBe(MCP);
    expect(env?.CLAUDE_CODE_OAUTH_TOKEN).toBe(LOGIN);
    expectClean(s.w, r);
  });

  it('a second start changes nothing: the workspace is kept and compose runs again', {
    timeout: T,
  }, () => {
    const s = setup();
    expect(s.go('start', ID).status).toBe(0);
    const again = s.go('start', ID);
    expect(again.status, again.stderr).toBe(0);
    expect(composeCalls(s.w, 'up')).toHaveLength(2);
    const copies = s.w.calls().filter((c) => c.includes(`geldar-wsinit-${ID}`));
    expect(copies).toHaveLength(1);
    expect(existsSync(join(vol(s.w, `geldar-ws-${ID}`), '.git'))).toBe(true);
  });

  it('stop and restart pass through to compose and keep the volumes', { timeout: T }, () => {
    const s = setup();
    const stop = s.go('stop', ID);
    expect(stop.status, stop.stderr).toBe(0);
    expect(stop.stderr).toContain(`${ID} is stopped`);
    expect(composeCalls(s.w, 'stop')).toEqual([
      ['compose', '-p', `geldar-player-${ID}`, '-f', PLAYER_YML, 'stop'],
    ]);
    const restart = s.go('restart', ID);
    expect(restart.status, restart.stderr).toBe(0);
    expect(restart.stderr).toContain(`${ID} is restarted`);
    expect(composeCalls(s.w, '--force-recreate')).toHaveLength(1);
    expect(s.w.calls().filter((c) => c[0] === 'volume')).toEqual([]);
  });

  it('deploy-key makes a 0600 key in a 0700 folder and prints only the public line', {
    timeout: T,
  }, () => {
    const s = setup({ key: false });
    const r = s.go('deploy-key', ID);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`ssh-ed25519 AAAAC3STUB1 geldar-${ID}\n`);
    expect(r.stderr).toContain('with write access');
    expect(r.stdout + r.stderr).not.toContain('PRIVATE');
    expect(readFileSync(join(s.p.stateDir, 'deploy-key'), 'utf8')).toContain('STUBPRIVATE1');
    if (process.platform !== 'win32') {
      expect(statSync(s.p.stateDir).mode & 0o777).toBe(0o700);
      expect(statSync(join(s.p.stateDir, 'deploy-key')).mode & 0o777).toBe(0o600);
    }
    const again = s.go('deploy-key', ID);
    expect(again.stdout).toBe(r.stdout);
    expect(readFileSync(join(s.w.root, 'keygen-count'), 'utf8')).toBe('1\n');
  });

  it('deploy-key --rotate replaces the key pair', { timeout: T }, () => {
    const s = setup({ key: false });
    expect(s.go('deploy-key', ID).status).toBe(0);
    const r = s.go('deploy-key', ID, '--rotate');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`ssh-ed25519 AAAAC3STUB2 geldar-${ID}\n`);
    expect(r.stderr).toContain('A new deploy key was made');
    expect(readFileSync(join(s.p.stateDir, 'deploy-key'), 'utf8')).toContain('STUBPRIVATE2');
    expect(r.stdout + r.stderr).not.toContain('PRIVATE');
  });

  it('player-status shows the supervisor and keeper status and the HELD reason', {
    timeout: T,
  }, () => {
    const s = setup();
    const sup = vol(s.w, `geldar-sup-${ID}`);
    writeFileSync(join(sup, 'status.json'), '{\n  "state": "running"\n}\n');
    const keep = vol(s.w, `geldar-keep-${ID}`);
    writeFileSync(
      join(keep, 'status.json'),
      '{\n  "last_pushed_head": "4f2c9a1",\n  "last_run_utc": "2026-01-10T23:00:00Z"\n}\n',
    );
    writeFileSync(join(keep, 'HELD'), 'the push was rejected: no write access\n');
    const r = s.go('player-status', ID);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('"state": "running"');
    expect(r.stdout).toContain('"last_pushed_head": "4f2c9a1"');
    expect(r.stderr).toContain(
      'The launch is held. Reason: the push was rejected: no write access',
    );
    expectClean(s.w, r);
  });

  it('logs masks the token, the login and token-like text', { timeout: T }, () => {
    const s = setup();
    writeFileSync(
      join(vol(s.w, `geldar-sup-${ID}`), 'supervisor.log'),
      `started with GELDAR_MCP_TOKEN=${MCP}\nlogin ${LOGIN}\nspare sk-ant-oat01-SPARE0123456789abcdef\n`,
    );
    writeFileSync(
      join(s.w.dockerRoot, 'compose-logs.txt'),
      `keeper | CLAUDE_CODE_OAUTH_TOKEN=${LOGIN}\n`,
    );
    const r = s.go('logs', ID);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('started with GELDAR_MCP_TOKEN=[masked]');
    expect(r.stdout).toContain('CLAUDE_CODE_OAUTH_TOKEN [masked]');
    expect(r.stdout).toContain('spare [masked]');
    expectClean(s.w, r);
  });

  it('release-hold prints the reason before it removes the hold; no hold is a plain message', {
    timeout: T,
  }, () => {
    const s = setup();
    const keep = vol(s.w, `geldar-keep-${ID}`);
    const reason = 'the push was rejected: no write access';
    writeFileSync(join(keep, 'HELD'), `${reason}\n`);
    const r = s.go('release-hold', ID);
    expect(r.status, r.stderr).toBe(0);
    const at = r.stderr.indexOf(reason);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(r.stderr.indexOf(`${ID} is released`));
    expect(existsSync(join(keep, 'HELD'))).toBe(false);
    const none = s.go('release-hold', ID);
    expect(none.status).toBe(0);
    expect(none.stderr).toContain(`${ID} is not held, so there is nothing to release`);
  });

  it('no token, key text or login value reaches output, a docker call or a compose environment', {
    timeout: T,
  }, () => {
    const s = setup();
    writeFileSync(
      join(vol(s.w, `geldar-sup-${ID}`), 'supervisor.log'),
      `token ${MCP} login ${LOGIN}\n`,
    );
    writeFileSync(
      join(vol(s.w, `geldar-keep-${ID}`), 'status.json'),
      `{\n  "last_pushed_head": "4f2c9a1",\n  "note": "${LOGIN}"\n}\n`,
    );
    writeFileSync(join(s.w.dockerRoot, 'compose-logs.txt'), `keeper | ${MCP}\n`);
    const runs = [
      s.go('start', ID),
      s.go('stop', ID),
      s.go('restart', ID),
      s.go('deploy-key', ID),
      s.go('player-status', ID),
      s.go('logs', ID),
      s.go('release-hold', ID),
    ];
    for (const r of runs) {
      expect(r.status, r.stderr).toBe(0);
      expectClean(s.w, r);
    }
  });
}
