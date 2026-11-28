import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { bashExe } from '../../launcher/test/harness.ts';
import { ciRequiresShells } from './bootstrap-helpers.ts';

// The root wrapper (F-05b) run against fakes: a fake runuser that runs its command as this user, a
// fake geldar-play that logs its argv and the environment it sees, and a fake chown that logs. The
// wrapper's header constants are rewritten to the temp world; the repo's files are never edited.
// The installer's tests live in install-wrapper.test.ts.
const here = dirname(fileURLToPath(import.meta.url));
const runnerDir = resolve(here, '..', 'runner');
const ID = 'ag-probe-00';
const SUDOERS_TEXT =
  'Defaults:geldar-runner env_reset,secure_path=/usr/local/bin:/usr/bin:/bin\n' +
  'geldar-runner ALL=(root) NOPASSWD: /usr/local/sbin/geldar-fleet-run\n';
const DOCKER_SOCKET = 'unix:///run/fleet-test.sock';

// Caller environment that must never reach the launcher: a fleet root seam, a token, a socket and a
// locale. BASH_ENV is added per world, since it names a file of the test.
const HOSTILE = {
  HOSTILE_TOKEN: 'leak-me',
  DOCKER_HOST: 'tcp://evil.example:2375',
  XDG_STATE_HOME: '/evil',
  GEL_ROOT: '/evil',
  GELDAR_INTERNAL: '1',
  LC_ALL: 'en_US.UTF-8',
  LANG: 'en_US.UTF-8',
};

const BAD_IDS = [
  'AG-x',
  'ag-a;b',
  'ag-x$(id)',
  'ag-x`id`',
  'ag-x b',
  'ag-x\nb',
  'ag-ab\n',
  'ag-*',
  'ag-?',
  'ag-café',
  '../x',
  'ag-',
  'ag-a--b',
  'ag-a-',
  `ag-${'a'.repeat(37)}`,
];

// Argument lists the wrapper must refuse with exit 2 and start nothing.
const BAD_CALLS: string[][] = [
  [],
  [''],
  ['bash', ID],
  ['exec', ID],
  ['start;id', ID],
  ['start'],
  ['start', ID, '--rm'],
  ['start', ID, '--kv'],
  ['start', ID, 'extra'],
  ['start', ID, '--repo=org/a'],
  ['adopt', ID, '--repo'],
  ['adopt', ID, '--repo', 'org/a;id'],
  ['adopt', ID, '--repo', 'org/$(id)'],
  ['adopt', ID, '--repo', 'org/a`id`'],
  ['adopt', ID, '--repo', 'org/a b'],
  ['adopt', ID, '--repo', 'org/a\nb'],
  ['adopt', ID, '--repo', 'org/..'],
  ['adopt', ID, '--repo', 'org/a/b'],
  ['adopt', ID, '--repo', ''],
  ['adopt', ID, '--token-file', '/etc/geldar/tokens/ag-other-00.token'],
  ['adopt', ID, '--token-file', '/etc/geldar/tokens/../keys/ag-probe-00'],
  ['adopt', ID, '--data-dir', '/srv/geldar/nvme-d/players/player-ag-other-00'],
  ['adopt', ID, '--data-dir', '/srv/geldar/nvme-x/players/player-ag-probe-00'],
  ['remove', ID, '--repo', 'org/a'],
  ['check-secrets', ID, '--yes'],
  ['check-login', ID],
  ['adopt', ID, '--no-start', '--no-start'],
  ['adopt', ID, '--repo', 'org/a', '--repo', 'org/b'],
  ['adopt', ID, '--repo', '-org/a'],
  ['adopt', ID, '--repo', 'org/-a'],
];

interface Setup {
  token?: string | null; // the token file's text; null leaves no token file
  key?: string | null; // the key file's text; null leaves no key file
  loginMode?: number | null; // the shared login's mode; null leaves no login file
  playFail?: boolean; // the fake geldar-play exits 4
  keyUid?: number; // the deploy key's owner uid as the fake stat reports it; 1001 when unset
}

interface World {
  wrapper: string;
  fakes: string;
  hostile: string; // a caller PATH folder with an env of its own, which must never run
  state: string;
  home: string;
  tokens: string;
  keys: string;
  login: string;
  playLog: string;
  runuserLog: string;
  wrapEnv: string; // the environment and PATH the fake runuser saw, one per line
  playFail: string;
  keyUid: string;
  bashEnv: string; // the BASH_ENV file of the hostile environment
  bashEnvRan: string; // present only if bash read BASH_ENV
}

const made: string[] = [];

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeExe(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

function readOr(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

// Rewrites each named readonly constant of the wrapper header. A name that is not found throws, so
// a test can never fall through to the real /etc or /home paths.
function rewrite(text: string, values: Record<string, string>): string {
  let out = text;
  for (const [name, value] of Object.entries(values)) {
    const re = new RegExp(`^readonly ${name}=.*$`, 'm');
    if (!re.test(out)) throw new Error(`the wrapper has no constant ${name}`);
    out = out.replace(re, () => `readonly ${name}=${value}`);
  }
  return out;
}

function makeWorld(setup: Setup = {}): World {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-f05b-wrap-'));
  made.push(dir);
  const w: World = {
    wrapper: join(dir, 'geldar-fleet-run'),
    fakes: join(dir, 'fakes'),
    hostile: join(dir, 'hostile'),
    state: join(dir, 'state'),
    home: join(dir, 'home'),
    tokens: join(dir, 'tokens'),
    keys: join(dir, 'keys'),
    login: join(dir, 'login.json'),
    playLog: join(dir, 'play.log'),
    runuserLog: join(dir, 'runuser.log'),
    wrapEnv: join(dir, 'wrap-env.log'),
    playFail: join(dir, 'play-fail'),
    keyUid: join(dir, 'key-uid'),
    bashEnv: join(dir, 'bash-env.sh'),
    bashEnvRan: join(dir, 'bash-env-ran'),
  };
  // The launcher keeps its player folders under <state>/geldar, as launcher/lib/common.sh does.
  for (const d of [w.fakes, w.hostile, w.state, join(w.state, 'geldar'), w.tokens, w.keys]) {
    mkdirSync(d, { recursive: true });
  }
  mkdirSync(join(w.home, 'scriptorium'), { recursive: true });
  writeFileSync(w.keyUid, `${setup.keyUid ?? 1001}\n`);
  writeFileSync(w.bashEnv, `echo ran > '${w.bashEnvRan}'\n`);
  writeExe(join(w.hostile, 'env'), `echo hostile-env >> '${w.playLog}'\nexit 9`);
  const token = setup.token === undefined ? 'test-registration-token' : setup.token;
  if (token !== null) writeFileSync(join(w.tokens, `${ID}.token`), token);
  const key = setup.key === undefined ? 'test-key-text' : setup.key;
  if (key !== null) writeFileSync(join(w.keys, ID), key);
  const loginMode = setup.loginMode === undefined ? 0o600 : setup.loginMode;
  if (loginMode !== null) {
    writeFileSync(w.login, '{}\n');
    chmodSync(w.login, loginMode);
  }
  if (setup.playFail) writeFileSync(w.playFail, '');

  // runuser logs its arguments and what it inherits (the locale and PATH), then runs the command.
  // geldar-play logs its argv, its directory, its umask and its environment. stat answers the key's
  // owner from the keyUid file; any other stat call is the real one.
  const bodies: Record<string, string> = {
    runuser: [
      `echo "$*" >> '${w.runuserLog}'`,
      `{ echo "LC_ALL=$LC_ALL"; echo "PATH=$PATH"; } >> '${w.wrapEnv}'`,
      'shift 3',
      'exec "$@"',
    ].join('\n'),
    'geldar-play': [
      `{ echo "argv: $*"; echo "cwd: $(pwd -P)"; echo "umask: $(umask)"; env; } >> '${w.playLog}'`,
      `if [ -e '${w.playFail}' ]; then exit 4; fi`,
    ].join('\n'),
    chown: `echo "chown $*" >> '${w.runuserLog}'`,
    stat: [
      'case "$*" in',
      `  *"%u"*) cat '${w.keyUid}' ;;`,
      '  *) exec /usr/bin/stat "$@" ;;',
      'esac',
    ].join('\n'),
  };
  for (const [name, body] of Object.entries(bodies)) writeExe(join(w.fakes, name), body);

  const text = readFileSync(join(runnerDir, 'geldar-fleet-run'), 'utf8');
  const rewritten = rewrite(text, {
    WRAP_LAUNCHER_USER: userInfo().username,
    WRAP_LAUNCHER_HOME: w.home,
    WRAP_PATH: `${w.fakes}:/usr/bin:/bin`,
    WRAP_DOCKER_HOST: DOCKER_SOCKET,
    WRAP_STATE_DIR: w.state,
    WRAP_PLAYER_STATE: join(w.state, 'geldar'),
    WRAP_RUNUSER: join(w.fakes, 'runuser'),
    WRAP_CHOWN: join(w.fakes, 'chown'),
    WRAP_STAT: join(w.fakes, 'stat'),
    WRAP_TOKEN_DIR: w.tokens,
    WRAP_KEY_DIR: w.keys,
    WRAP_LOGIN: w.login,
  });
  writeFileSync(w.wrapper, rewritten, { mode: 0o755 });
  return w;
}

// The keyed path the launcher writes a player's deploy key to: <state>/geldar/<id>/deploy-key.
function keyPath(w: World): string {
  return join(w.state, 'geldar', ID, 'deploy-key');
}

// Builds the deploy key where the launcher leaves it after deploy-key.
function placeKey(w: World): void {
  mkdirSync(dirname(keyPath(w)), { recursive: true });
  writeFileSync(keyPath(w), 'key\n');
}

// Runs the wrapper as sudo does: the hostile environment, a caller PATH whose first folder holds an
// env that must never run, a caller umask of 077 and a caller directory away from the clone. The
// wrapper runs under bash -p, the flag its shebang carries, so BASH_ENV is not read. `extra` adds
// variables to the caller's environment.
function runWrapper(w: World, args: string[], extra: Record<string, string> = {}) {
  const argv = ['-p', '-c', 'umask 0077; exec "$0" "$@"', w.wrapper, ...args];
  const r = spawnSync(bashExe as string, argv, {
    cwd: w.state,
    env: {
      ...HOSTILE,
      PATH: `${w.hostile}:/nonexistent:/usr/bin:/bin`,
      BASH_ENV: w.bashEnv,
      ...extra,
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// The wrapper and the installer need bash and POSIX exec bits: win32 skips with the reason.
const win = process.platform === 'win32';
const skipReason = win
  ? 'fake commands need POSIX exec bits (win32)'
  : bashExe
    ? ''
    : 'bash is missing';
if (skipReason) {
  if (!win && ciRequiresShells(process.env.CI)) {
    throw new Error(`root wrapper tests cannot run under CI: ${skipReason}`);
  }
  console.warn(`SKIPPED: ${skipReason}; root wrapper tests did not run`);
}
const describeBash = skipReason ? describe.skip : describe;

// The deploy-key chown on a real tree needs Linux, and chown to uid 1002 needs root. Each reason is
// printed when the test is skipped.
const chownSkip =
  process.platform !== 'linux'
    ? 'the real chown needs Linux (win32 has no POSIX owners)'
    : process.getuid?.() !== 0
      ? 'chown to uid 1002 needs root'
      : '';
if (chownSkip) console.warn(`SKIPPED: ${chownSkip}; the real deploy-key chown did not run`);
const itChown = chownSkip ? it.skip : it;

describeBash('root wrapper (F-05b)', () => {
  it('refuses every bad id with exit 2 and starts nothing', () => {
    for (const id of BAD_IDS) {
      const w = makeWorld();
      const r = runWrapper(w, ['start', id]);
      expect(r.status, `${JSON.stringify(id)}: ${r.out}`).toBe(2);
      expect(readOr(w.runuserLog), JSON.stringify(id)).toBe('');
      expect(readOr(w.playLog), JSON.stringify(id)).toBe('');
    }
  });

  it('refuses bad arguments of every kind with exit 2 and starts nothing', () => {
    for (const args of BAD_CALLS) {
      const w = makeWorld();
      const r = runWrapper(w, args);
      expect(r.status, `${JSON.stringify(args)}: ${r.out}`).toBe(2);
      expect(readOr(w.runuserLog), JSON.stringify(args)).toBe('');
      expect(readOr(w.playLog), JSON.stringify(args)).toBe('');
    }
  });

  it('starts a good id with a fixed environment and nothing from the caller', () => {
    const w = makeWorld();
    const r = runWrapper(w, ['start', ID]);
    expect(r.status, r.out).toBe(0);
    const log = readOr(w.playLog).split('\n');
    expect(log[0]).toBe(`argv: start ${ID}`);
    expect(log).toContain(`DOCKER_HOST=${DOCKER_SOCKET}`);
    expect(log).toContain(`PATH=${w.fakes}:/usr/bin:/bin`);
    expect(log).toContain(`XDG_STATE_HOME=${w.state}`);
    expect(log).toContain(`HOME=${w.home}`);
    expect(log.join('\n')).not.toMatch(/HOSTILE_TOKEN|GEL_ROOT|GELDAR_INTERNAL|evil/);
    expect(existsSync(w.bashEnvRan)).toBe(false);
  });

  it('keeps BASH_ENV, ENV, LD_PRELOAD and the caller variables away from the launcher', () => {
    const w = makeWorld();
    const r = runWrapper(w, ['start', ID], {
      ENV: w.bashEnv,
      LD_PRELOAD: join(w.hostile, 'preload.so'),
    });
    expect(r.status, r.out).toBe(0);
    const log = readOr(w.playLog).split('\n');
    for (const name of ['BASH_ENV', 'ENV', 'LD_PRELOAD']) {
      expect(
        log.some((line) => line.startsWith(`${name}=`)),
        name,
      ).toBe(false);
    }
    expect(log.join('\n')).not.toMatch(/HOSTILE_TOKEN|leak-me/);
    expect(existsSync(w.bashEnvRan)).toBe(false);
  });

  it('pins PATH, locale, umask and directory, and starts runuser as the launcher', () => {
    const w = makeWorld();
    const r = runWrapper(w, ['start', ID]);
    expect(r.status, r.out).toBe(0);
    const pinned = `${w.fakes}:/usr/bin:/bin`;
    // geldar-play's view: its PATH is the pinned one, its umask 022 and its directory the clone.
    const log = readOr(w.playLog).split('\n');
    expect(log).toContain(`PATH=${pinned}`);
    expect(log).toContain('umask: 0022');
    expect(log).toContain(`cwd: ${realpathSync(join(w.home, 'scriptorium'))}`);
    // runuser's view, from the wrapper: the locale is pinned to C and the PATH is the pinned one.
    const wrapEnv = readOr(w.wrapEnv).split('\n');
    expect(wrapEnv).toContain('LC_ALL=C');
    expect(wrapEnv).toContain(`PATH=${pinned}`);
    // The launcher account is named with -u, and -- ends runuser's own options.
    const invocation = readOr(w.runuserLog).split('\n')[0];
    expect(invocation.split(' ').slice(0, 3)).toEqual(['-u', userInfo().username, '--']);
  });

  it('passes the flags of the verb through, with a value for each value flag', () => {
    const w = makeWorld();
    const r = runWrapper(w, [
      'adopt',
      ID,
      '--repo',
      'example-org/player-ag-probe-00',
      '--token-file',
      `${w.tokens}/${ID}.token`,
      '--no-start',
    ]);
    expect(r.status, r.out).toBe(0);
    const tokenPath = `${w.tokens}/${ID}.token`;
    const argv = readOr(w.playLog).split('\n')[0];
    expect(argv).toBe(
      `argv: adopt ${ID} --repo example-org/player-ag-probe-00 --token-file ${tokenPath} --no-start`,
    );
  });

  it('passes a launcher exit code through unchanged', () => {
    const w = makeWorld({ playFail: true });
    expect(runWrapper(w, ['start', ID]).status).toBe(4);
  });

  it('runs the interim deploy-key chown after success, and not after a failure', () => {
    const ok = makeWorld();
    placeKey(ok);
    expect(runWrapper(ok, ['deploy-key', ID]).status).toBe(0);
    expect(readOr(ok.runuserLog)).toContain(
      `chown -h --from=geldar:geldar 1002:1002 -- ${keyPath(ok)}`,
    );
    const bad = makeWorld({ playFail: true });
    placeKey(bad);
    expect(runWrapper(bad, ['deploy-key', ID]).status).toBe(4);
    expect(readOr(bad.runuserLog)).not.toContain('chown');
  });

  it('skips the deploy-key chown when the key is already owned by uid 1002, and exits 0', () => {
    const w = makeWorld({ keyUid: 1002 });
    placeKey(w);
    const r = runWrapper(w, ['deploy-key', ID]);
    expect(r.status, r.out).toBe(0);
    expect(readOr(w.runuserLog)).not.toContain('chown');
  });

  itChown('the deploy-key chown changes the key on a temp tree to uid 1002', () => {
    const w = makeWorld();
    // The real chown, with its --from filter dropped: the test's key is owned by root, not by
    // geldar. The wrapper's stat still reports 1001, so the wrapper runs the chown.
    writeExe(
      join(w.fakes, 'chown'),
      'for last; do :; done\nexec /usr/bin/chown -h 1002:1002 -- "$last"',
    );
    placeKey(w);
    const r = runWrapper(w, ['deploy-key', ID]);
    expect(r.status, r.out).toBe(0);
    expect(statSync(keyPath(w)).uid).toBe(1002);
  });

  it('refuses a symlink on the deploy-key path with exit 7 and chowns nothing', () => {
    for (const link of ['id-dir', 'key-file']) {
      const w = makeWorld();
      const real = join(dirname(w.wrapper), `real-${link}`);
      mkdirSync(real);
      if (link === 'id-dir') {
        symlinkSync(real, join(w.state, 'geldar', ID));
      } else {
        mkdirSync(join(w.state, 'geldar', ID));
        symlinkSync(real, keyPath(w));
      }
      const r = runWrapper(w, ['deploy-key', ID]);
      expect(r.status, `${link}: ${r.out}`).toBe(7);
      expect(readOr(w.runuserLog), link).not.toContain('chown');
    }
  });

  it('accepts a 39-character id, the longest the launcher allows', () => {
    const longId = `ag-${'a'.repeat(36)}`;
    const w = makeWorld();
    const r = runWrapper(w, ['start', longId]);
    expect(r.status, r.out).toBe(0);
    expect(readOr(w.playLog).split('\n')[0]).toBe(`argv: start ${longId}`);
  });

  it('check-secrets exits 6 for a bad secret and 0 for good ones', () => {
    expect(runWrapper(makeWorld({ token: '' }), ['check-secrets', ID]).status).toBe(6);
    expect(runWrapper(makeWorld({ key: null }), ['check-secrets', ID]).status).toBe(6);
    const good = makeWorld();
    const r = runWrapper(good, ['check-secrets', ID]);
    expect(r.status, r.out).toBe(0);
    expect(readOr(good.playLog)).toBe('');
  });

  it('check-login exits 6 for a missing or open login, and 0 for a 0600 login', () => {
    expect(runWrapper(makeWorld({ loginMode: null }), ['check-login']).status).toBe(6);
    expect(runWrapper(makeWorld({ loginMode: 0o644 }), ['check-login']).status).toBe(6);
    expect(runWrapper(makeWorld({ loginMode: 0o600 }), ['check-login']).status).toBe(0);
  });

  it('keeps the sudoers file to the env_reset default and one rule for the runner account', () => {
    const text = readFileSync(join(runnerDir, 'geldar-fleet-sudoers'), 'utf8');
    expect(text).toBe(SUDOERS_TEXT);
  });
});

// shellcheck is optional on the machine: the lint runs when it is installed and is skipped, with a
// message, when it is not.
const shellcheckFound = spawnSync('shellcheck', ['--version'], { encoding: 'utf8' });
const hasShellcheck = !shellcheckFound.error && shellcheckFound.status === 0;
if (!hasShellcheck) {
  console.warn('SKIPPED: shellcheck is missing; the wrapper lint did not run');
}

describe('root wrapper lint (F-05b)', () => {
  it.skipIf(!hasShellcheck)('passes shellcheck -x and never turns on set -x', () => {
    const path = join(runnerDir, 'geldar-fleet-run');
    const r = spawnSync('shellcheck', ['-x', path], { encoding: 'utf8' });
    expect(r.status, `${r.stdout ?? ''}${r.stderr ?? ''}`).toBe(0);
    expect(readFileSync(path, 'utf8')).not.toMatch(/set -x/);
  });
});
