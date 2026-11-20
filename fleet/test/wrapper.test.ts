import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
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
const here = dirname(fileURLToPath(import.meta.url));
const runnerDir = resolve(here, '..', 'runner');
const ID = 'ag-probe-00';
const SUDOERS_RULE = 'geldar-runner ALL=(root) NOPASSWD: /usr/local/sbin/geldar-fleet-run\n';
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
// wrapper runs under bash -p, the flag its shebang carries, so BASH_ENV is not read.
function runWrapper(w: World, args: string[]) {
  const argv = ['-p', '-c', 'umask 0077; exec "$0" "$@"', w.wrapper, ...args];
  const r = spawnSync(bashExe as string, argv, {
    cwd: w.state,
    env: { ...HOSTILE, PATH: `${w.hostile}:/nonexistent:/usr/bin:/bin`, BASH_ENV: w.bashEnv },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// Installer world: copies of the installer, the wrapper and the sudoers rule in a temp runner dir,
// a fake visudo, id and install, and a temp root for GEL_ROOT.
function installWorld(opts: { visudoFails?: boolean; mvFails?: boolean } = {}) {
  const { visudoFails = false, mvFails = false } = opts;
  const dir = mkdtempSync(join(tmpdir(), 'fleet-f05b-inst-'));
  made.push(dir);
  const src = join(dir, 'runner');
  const fakes = join(dir, 'fakes');
  const root = join(dir, 'root');
  const calls = join(dir, 'calls.log');
  for (const d of [src, fakes, root]) mkdirSync(d);
  for (const f of ['install-wrapper.sh', 'geldar-fleet-run', 'geldar-fleet-sudoers']) {
    copyFileSync(join(runnerDir, f), join(src, f));
  }
  writeExe(join(fakes, 'id'), 'echo 0');
  writeExe(join(fakes, 'visudo'), `echo "visudo $*" >> '${calls}'\nexit ${visudoFails ? 1 : 0}`);
  // mkdir and install only act under GEL_ROOT: a real install path is refused, so a seam that is
  // ignored shows up as exit 7 with the real path in the log, and nothing is written outside.
  writeExe(
    join(fakes, 'mkdir'),
    `echo "mkdir $*" >> '${calls}'\nfor a in "$@"; do\n  case "$a" in\n    -p | "$GEL_ROOT"/*) ;;\n    *) exit 1 ;;\n  esac\ndone\ncommand -p mkdir "$@"`,
  );
  // mv logs its arguments. With mvFails set it fails at once; otherwise it is the real mv.
  writeExe(
    join(fakes, 'mv'),
    `echo "mv $*" >> '${calls}'\n${mvFails ? 'exit 1' : 'command -p mv "$@"'}`,
  );
  // install -o root -g root -m MODE SRC DST: the source is argument 7, the destination 8.
  writeExe(
    join(fakes, 'install'),
    `echo "install $*" >> '${calls}'\ncase "$8" in\n  "$GEL_ROOT"/*) cp "$7" "$8" ;;\n  *) exit 1 ;;\nesac`,
  );
  return { src, fakes, root, calls, script: join(src, 'install-wrapper.sh') };
}

// Runs the installer. The GEL_ROOT seam is set only when `internal` is true, so the test of a
// seam that must be ignored can run without GELDAR_INTERNAL=1.
function runInstall(iw: ReturnType<typeof installWorld>, internal = true) {
  const seam = internal ? { GELDAR_INTERNAL: '1' } : {};
  const r = spawnSync(bashExe as string, [iw.script], {
    env: { PATH: `${iw.fakes}:/usr/bin:/bin`, GEL_ROOT: iw.root, ...seam },
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

  it('keeps the interim chown line in the wrapper, marked for deletion with R-4', () => {
    const text = readFileSync(join(runnerDir, 'geldar-fleet-run'), 'utf8');
    expect(text).toContain('"$WRAP_CHOWN" -h --from=geldar:geldar 1002:1002 -- "$key"');
    expect(text).toMatch(/Delete with R-4\./);
  });

  it('runs under bash -p, the shebang the sudoers rule relies on', () => {
    const text = readFileSync(join(runnerDir, 'geldar-fleet-run'), 'utf8');
    expect(text.split('\n')[0]).toBe('#!/bin/bash -p');
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

  it('keeps the sudoers file to exactly one rule for the runner account', () => {
    const text = readFileSync(join(runnerDir, 'geldar-fleet-sudoers'), 'utf8');
    expect(text).toBe(SUDOERS_RULE);
  });

  it('checks the sudoers rule with visudo under a temp name, then renames both files', () => {
    const iw = installWorld();
    const r = runInstall(iw);
    expect(r.status, r.out).toBe(0);
    const srcRun = join(iw.src, 'geldar-fleet-run');
    const srcSudoers = join(iw.src, 'geldar-fleet-sudoers');
    const dstRun = join(iw.root, 'usr', 'local', 'sbin', 'geldar-fleet-run');
    const dstSudoers = join(iw.root, 'etc', 'sudoers.d', 'geldar-fleet');
    const tmpRun = `${dstRun}.new`;
    const tmp = `${dstSudoers}.new`;
    expect(readOr(iw.calls).split('\n').filter(Boolean)).toEqual([
      `mkdir -p ${dirname(dstRun)} ${dirname(dstSudoers)}`,
      `install -o root -g root -m 0755 ${srcRun} ${tmpRun}`,
      `install -o root -g root -m 0440 ${srcSudoers} ${tmp}`,
      `visudo -cf ${tmp}`,
      `mv -f ${tmpRun} ${dstRun}`,
      `mv -f ${tmp} ${dstSudoers}`,
    ]);
    expect(readOr(dstRun)).toBe(readOr(srcRun));
    expect(readOr(dstSudoers)).toBe(SUDOERS_RULE);
    expect(existsSync(tmpRun)).toBe(false);
    expect(existsSync(tmp)).toBe(false);
  });

  it('installs neither file when visudo refuses the rule, and removes both temp files', () => {
    const iw = installWorld({ visudoFails: true });
    const r = runInstall(iw);
    expect(r.status).toBe(7);
    const dstRun = join(iw.root, 'usr', 'local', 'sbin', 'geldar-fleet-run');
    const dstSudoers = join(iw.root, 'etc', 'sudoers.d', 'geldar-fleet');
    expect(existsSync(dstSudoers)).toBe(false);
    expect(existsSync(`${dstSudoers}.new`)).toBe(false);
    expect(existsSync(dstRun)).toBe(false);
    expect(existsSync(`${dstRun}.new`)).toBe(false);
    expect(readOr(iw.calls)).toContain(`visudo -cf ${dstSudoers}.new`);
    expect(readOr(iw.calls)).not.toContain('mv -f');
  });

  it('removes both temp files when a step fails after they are made, through the ERR trap', () => {
    const iw = installWorld({ mvFails: true });
    const r = runInstall(iw);
    expect(r.status, r.out).toBe(7);
    expect(r.out).toContain('step failed at line');
    const dstRun = join(iw.root, 'usr', 'local', 'sbin', 'geldar-fleet-run');
    const dstSudoers = join(iw.root, 'etc', 'sudoers.d', 'geldar-fleet');
    expect(existsSync(`${dstRun}.new`)).toBe(false);
    expect(existsSync(`${dstSudoers}.new`)).toBe(false);
    expect(existsSync(dstRun)).toBe(false);
    expect(existsSync(dstSudoers)).toBe(false);
  });

  it('ignores GEL_ROOT when GELDAR_INTERNAL is not 1, and writes nothing under it', () => {
    const iw = installWorld();
    const r = runInstall(iw, false);
    // The fake mkdir refuses the real path; the exit code is not what this test pins, the log is.
    expect(r.status).not.toBe(0);
    expect(readOr(iw.calls)).toContain('mkdir -p /usr/local/sbin');
    expect(readOr(iw.calls)).not.toContain(iw.root);
    expect(existsSync(join(iw.root, 'usr'))).toBe(false);
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
