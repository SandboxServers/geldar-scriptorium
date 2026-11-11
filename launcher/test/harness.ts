import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { enabled } from './parity.ts';

// Shared test support for the launcher (SC-50a). Every later launcher packet uses it.

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const win = process.platform === 'win32';

export interface Launcher {
  name: 'bash' | 'pwsh';
  command: string;
  prefix: string[];
  entry: string;
}

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  env?: Record<string, string>;
  cwd?: string;
  input?: string;
  timeoutMs?: number;
}

// Git for Windows' bash, never WSL's C:\Windows\System32\bash.exe.
function findBash(): string | undefined {
  const candidates: string[] = [];
  if (win) {
    const where = spawnSync('where', ['git'], { encoding: 'utf8' });
    for (const line of (where.stdout ?? '').split(/\r?\n/).filter(Boolean)) {
      candidates.push(resolve(dirname(line), '..', 'bin', 'bash.exe'));
      candidates.push(resolve(dirname(line), '..', '..', 'bin', 'bash.exe'));
    }
    candidates.push('C:\\Program Files\\Git\\bin\\bash.exe');
  } else {
    candidates.push('bash');
  }
  for (const c of candidates) {
    if (win && !existsSync(c)) continue;
    if (spawnSync(c, ['--version'], { encoding: 'utf8' }).status === 0) return c;
  }
  return undefined;
}

export const bashExe = findBash();
// Git for Windows' root: its usr/bin holds sh, perl, tar, awk and sed.
const gitRoot = win && bashExe ? resolve(dirname(bashExe), '..') : undefined;

function detect(): Launcher[] {
  const found: Launcher[] = [];
  if (bashExe) {
    found.push({
      name: 'bash',
      command: bashExe,
      prefix: [],
      entry: join(repoRoot, 'launcher', 'geldar-play'),
    });
    console.info(`launcher tests: bash is ${bashExe}`);
  }
  const ps1 = join(repoRoot, 'launcher', 'geldar-play.ps1');
  if (existsSync(ps1) && spawnSync('pwsh', ['-NoProfile', '-Command', '1'], {}).status === 0) {
    found.push({ name: 'pwsh', command: 'pwsh', prefix: ['-NoProfile', '-File'], entry: ps1 });
  }
  return found;
}

export const launchers: Launcher[] = detect();

// Launchers whose entry in parity.ts lists the group.
export function forGroup(group: string): Launcher[] {
  return launchers.filter((l) => (enabled[l.name] as string[]).includes(group));
}

// A path as the bash launcher sees it: /c/dir on Windows, unchanged elsewhere.
export function bashPath(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!win || !m) return p;
  return `/${(m[1] ?? '').toLowerCase()}/${(m[2] ?? '').replace(/\\/g, '/')}`;
}

export interface World {
  root: string;
  state: string;
  players: string;
  origin: string;
  fakeDir: string;
  dockerRoot: string;
  gitLog: string;
  home: string;
  audit: boolean;
  // The environment to pass to run() for each launcher (paths in the form that launcher uses).
  env: Record<string, string>;
  envPwsh: Record<string, string>;
  calls(): string[][];
  gitCalls(): string[][];
}

const worlds: World[] = [];

function readLog(path: string): string[][] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => l.split('\t'));
}

const gitWrapper = `#!/bin/sh
# Logging stand-in for git (GELDAR_GIT). FAKE_GIT_SLEEP_ON=<subcommand> makes that subcommand
# sleep with SIGPIPE ignored; every other call runs the real git.
if [ -n "\${GELDAR_TEST_GITLOG:-}" ]; then
  tab=$(printf '\\t')
  line=""
  sep=""
  for a in "$@"; do
    line="$line$sep$a"
    sep=$tab
  done
  printf '%s\\n' "$line" >> "$GELDAR_TEST_GITLOG"
fi
if [ -n "\${FAKE_GIT_SLEEP_ON:-}" ]; then
  sub=""
  skip=0
  for a in "$@"; do
    if [ $skip = 1 ]; then
      skip=0
      continue
    fi
    case $a in
      -c | -C) skip=1; continue ;;
      -*) continue ;;
    esac
    sub=$a
    break
  done
  if [ "$sub" = "$FAKE_GIT_SLEEP_ON" ]; then
    trap '' PIPE
    sleep "\${FAKE_GIT_SLEEP_SEC:-30}" &
    [ -z "\${FAKE_PIDFILE:-}" ] || echo "$!" >> "$FAKE_PIDFILE"
    wait
    exit 1
  fi
fi
exec git "$@"
`;

export function makeWorld(): World {
  const root = mkdtempSync(join(tmpdir(), 'gp-'));
  const dirs = ['state', 'players', 'origin', 'fake', 'dockerroot', 'home'];
  for (const d of dirs) mkdirSync(join(root, d), { recursive: true });
  const fakeDir = join(root, 'fake');
  const fakeDocker = join(repoRoot, 'launcher', 'test', 'fake-docker.sh');
  const dockerRoot = join(root, 'dockerroot');
  const gitLog = join(root, 'git.log');
  writeFileSync(join(fakeDir, 'docker'), `#!/bin/sh\nexec sh "${bashPath(fakeDocker)}" "$@"\n`);
  writeFileSync(join(fakeDir, 'git-wrap'), gitWrapper);
  writeFileSync(
    join(root, 'gitconfig'),
    '[user]\n\tname = Test\n\temail = test@example.test\n[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n',
  );
  chmodSync(join(fakeDir, 'docker'), 0o755);
  chmodSync(join(fakeDir, 'git-wrap'), 0o755);
  if (win && bashExe) {
    writeFileSync(join(fakeDir, 'docker.cmd'), `@"${bashExe}" "${fakeDocker}" %*\r\n`);
    const wrap = bashPath(join(fakeDir, 'git-wrap'));
    writeFileSync(join(fakeDir, 'git.cmd'), `@"${bashExe}" "${wrap}" %*\r\n`);
  }
  const common = {
    FAKE_DOCKER_ROOT: bashPath(dockerRoot),
    GELDAR_TEST_GITLOG: bashPath(gitLog),
    GELDAR_INTERNAL: '1',
    GIT_CONFIG_GLOBAL: bashPath(join(root, 'gitconfig')),
    HOME: bashPath(join(root, 'home')),
  };
  const world: World = {
    root,
    state: join(root, 'state'),
    players: join(root, 'players'),
    origin: join(root, 'origin'),
    fakeDir,
    dockerRoot,
    gitLog,
    home: join(root, 'home'),
    audit: true,
    env: {
      ...common,
      GELDAR_STATE_DIR: bashPath(join(root, 'state')),
      GELDAR_PLAYERS_DIR: bashPath(join(root, 'players')),
      GELDAR_DOCKER: bashPath(join(fakeDir, 'docker')),
      GELDAR_GIT: bashPath(join(fakeDir, 'git-wrap')),
    },
    envPwsh: {
      ...common,
      // The fakes are shell scripts: they see bash-style paths even when pwsh launches them.
      FAKE_DOCKER_ROOT: bashPath(dockerRoot),
      GELDAR_STATE_DIR: join(root, 'state'),
      GELDAR_PLAYERS_DIR: join(root, 'players'),
      GELDAR_DOCKER: join(fakeDir, win ? 'docker.cmd' : 'docker'),
      GELDAR_GIT: join(fakeDir, win ? 'git.cmd' : 'git-wrap'),
    },
    calls: () => readLog(join(dockerRoot, 'calls.log')),
    gitCalls: () => readLog(gitLog),
  };
  worlds.push(world);
  return world;
}

export function git(cwd: string, args: string[], env?: Record<string, string>): string {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

// SC-80: a player's mcp_url host must equal mcp_base of the launcher's world.conf, and most tests use
// a share without one, so the fixture URL is built from the shipped file's mcp_base.
const shippedBase =
  /^mcp_base=(.+?)\r?$/m.exec(
    readFileSync(join(repoRoot, 'launcher', 'config', 'world.conf'), 'utf8'),
  )?.[1] ?? '';
export const FIXTURE_MCP_HOST = new URL(shippedBase).hostname;
export const FIXTURE_MCP_URL = `${shippedBase}/mcp`;

export interface Player {
  id: string;
  clone: string;
  origin: string;
  stateDir: string;
}

// A player repository as `new` would leave it: the template commit, then a host commit that adds
// a file under memory/ (START is the second commit), pushed to a bare origin and cloned.
export function makePlayer(
  world: World,
  opts: { id: string; mode?: string; kitImage?: string },
): Player {
  const gitEnv = { GIT_CONFIG_GLOBAL: join(world.root, 'gitconfig') };
  const work = join(world.root, 'work', opts.id);
  mkdirSync(work, { recursive: true });
  cpSync(join(repoRoot, 'template'), work, { recursive: true });
  const player = {
    player_id: opts.id,
    name: opts.id,
    shard: 'test',
    mcp_url: FIXTURE_MCP_URL,
    harness: 'claude',
    declared_model: 'haiku',
    kit_version: '0.0.0',
    kit_image: opts.kitImage ?? `registry.test/geldar-kit@sha256:${'a'.repeat(64)}`,
  };
  writeFileSync(join(work, 'player.json'), `${JSON.stringify(player, null, 2)}\n`);
  git(work, ['init', '-b', 'main'], gitEnv);
  git(work, ['add', '-A'], gitEnv);
  git(work, ['commit', '-m', 'template'], gitEnv);
  mkdirSync(join(work, 'memory'), { recursive: true });
  writeFileSync(join(work, 'memory', 'host-note.md'), 'A note from the host.\n');
  git(work, ['add', '-A'], gitEnv);
  git(work, ['commit', '-m', 'host note'], {
    ...gitEnv,
    GIT_AUTHOR_NAME: 'Host',
    GIT_AUTHOR_EMAIL: 'host@example.test',
    GIT_COMMITTER_NAME: 'Host',
    GIT_COMMITTER_EMAIL: 'host@example.test',
  });
  const origin = join(world.origin, `${opts.id}.git`);
  git(world.root, ['init', '--bare', '-b', 'main', origin], gitEnv);
  git(work, ['remote', 'add', 'origin', origin], gitEnv);
  git(work, ['push', 'origin', 'main'], gitEnv);
  const clone = join(world.players, opts.id);
  git(world.root, ['clone', origin, clone], gitEnv);
  const stateDir = join(world.state, opts.id);
  mkdirSync(stateDir, { recursive: true });
  // Forward slashes: valid for both launchers (Git bash and pwsh) on Windows.
  writeFileSync(join(stateDir, 'clone'), `${clone.replace(/\\/g, '/')}\n`, { mode: 0o600 });
  writeFileSync(join(stateDir, 'branch'), 'main\n', { mode: 0o600 });
  return { id: opts.id, clone, origin, stateDir };
}

// The process environment without any GELDAR_ or FAKE_ variable, plus the given ones.
export function childEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const k of Object.keys(base)) {
    if (k.startsWith('GELDAR_') || k.startsWith('FAKE_')) delete base[k];
  }
  if (gitRoot) {
    const dirs = [join(gitRoot, 'usr', 'bin'), join(gitRoot, 'mingw64', 'bin')];
    base.PATH = `${dirs.join(';')};${base.PATH ?? ''}`;
  }
  return { ...base, ...extra };
}

// Runs the launcher in a clean environment plus opts.env.
export function run(launcher: Launcher, args: string[], opts: RunOptions = {}): RunResult {
  const r = spawnSync(launcher.command, [...launcher.prefix, launcher.entry, ...args], {
    cwd: opts.cwd ?? repoRoot,
    encoding: 'utf8',
    input: opts.input,
    timeout: opts.timeoutMs ?? 60_000,
    env: childEnv(opts.env),
  });
  return { status: r.status ?? 124, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// Runs a bash script with the shell's own PATH rules (for tests that source the lib files).
export function runBash(script: string, opts: RunOptions = {}): RunResult {
  if (!bashExe) throw new Error('bash is not available');
  const bash: Launcher = { name: 'bash', command: bashExe, prefix: ['-c'], entry: script };
  return run(bash, [], opts);
}

// Runs a snippet with the launcher's own common functions loaded: bash sources lib/common.sh,
// pwsh dot-sources lib/common.ps1 (and loads the messages). The snippets do the same job.
export function runLib(
  launcher: Launcher,
  scripts: { bash: string; pwsh: string },
  opts: RunOptions = {},
): RunResult {
  if (launcher.name === 'bash') {
    const lib = bashPath(join(repoRoot, 'launcher', 'lib', 'common.sh'));
    return runBash(`. '${lib}'; ${scripts.bash}`, opts);
  }
  const dir = join(repoRoot, 'launcher').replace(/'/g, "''");
  const prelude = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
    `$GP_DIR = '${dir}'`,
    ". (Join-Path $GP_DIR 'lib/common.ps1')",
    'Import-Messages',
  ].join('\n');
  const ps: Launcher = {
    name: 'pwsh',
    command: 'pwsh',
    prefix: ['-NoProfile', '-Command'],
    entry: `${prelude}\n${scripts.pwsh}`,
  };
  return run(ps, [], opts);
}

function auditCalls(world: World): void {
  const home = homedir().replace(/\\/g, '/').replace(/\/$/, '');
  for (const argv of world.calls()) {
    const text = argv.join(' ');
    const at = (flag: string) => argv.indexOf(flag);
    if (argv[0] === 'run') {
      if (argv[at('--cap-drop') + 1] !== 'ALL')
        throw new Error(`run without --cap-drop ALL: ${text}`);
      if (argv[at('--security-opt') + 1] !== 'no-new-privileges') {
        throw new Error(`run without --security-opt no-new-privileges: ${text}`);
      }
    }
    const denied =
      argv.includes('--privileged') ||
      argv.includes('--network=host') ||
      (at('--network') >= 0 && argv[at('--network') + 1] === 'host') ||
      argv.some((a) => a === '--pid' || a.startsWith('--pid=')) ||
      argv.includes('--user=0') ||
      (at('--user') >= 0 && ['0', 'root'].includes(argv[at('--user') + 1] ?? '')) ||
      text.includes('docker.sock') ||
      argv.some((a, i) => argv[i - 1] === '-v' && (a.startsWith('/:') || a.split(':')[0] === home));
    if (denied) throw new Error(`denied docker call: ${text}`);
  }
}

afterEach(() => {
  const errors: string[] = [];
  for (const world of worlds.splice(0)) {
    try {
      if (world.audit) auditCalls(world);
    } catch (e) {
      errors.push((e as Error).message);
    }
    rmSync(world.root, { recursive: true, force: true, maxRetries: 3 });
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
});
