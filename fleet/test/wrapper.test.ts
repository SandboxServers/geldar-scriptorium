import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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

// Caller environment that must never reach the launcher: a fleet root seam, a token and a socket.
const HOSTILE = {
  HOSTILE_TOKEN: 'leak-me',
  DOCKER_HOST: 'tcp://evil.example:2375',
  XDG_STATE_HOME: '/evil',
  GEL_ROOT: '/evil',
  GELDAR_INTERNAL: '1',
};

const BAD_IDS = [
  'AG-x',
  'ag-a;b',
  'ag-x$(id)',
  'ag-x`id`',
  'ag-x b',
  'ag-x\nb',
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
];

interface Setup {
  token?: string | null; // the token file's text; null leaves no token file
  key?: string | null; // the key file's text; null leaves no key file
  loginMode?: number | null; // the shared login's mode; null leaves no login file
  playFail?: boolean; // the fake geldar-play exits 4
}

interface World {
  wrapper: string;
  fakes: string;
  state: string;
  home: string;
  tokens: string;
  keys: string;
  login: string;
  playLog: string;
  runuserLog: string;
  playFail: string;
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
    state: join(dir, 'state'),
    home: join(dir, 'home'),
    tokens: join(dir, 'tokens'),
    keys: join(dir, 'keys'),
    login: join(dir, 'login.json'),
    playLog: join(dir, 'play.log'),
    runuserLog: join(dir, 'runuser.log'),
    playFail: join(dir, 'play-fail'),
  };
  for (const d of [w.fakes, w.state, join(w.home, 'scriptorium'), w.tokens, w.keys]) {
    mkdirSync(d, { recursive: true });
  }
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

  const bodies: Record<string, string> = {
    runuser: `echo "$*" >> '${w.runuserLog}'\nshift 3\nexec "$@"`,
    'geldar-play': [
      `{ echo "argv: $*"; env; } >> '${w.playLog}'`,
      `if [ -e '${w.playFail}' ]; then exit 4; fi`,
    ].join('\n'),
    chown: `echo "chown $*" >> '${w.runuserLog}'`,
  };
  for (const [name, body] of Object.entries(bodies)) writeExe(join(w.fakes, name), body);

  const text = readFileSync(join(runnerDir, 'geldar-fleet-run'), 'utf8');
  const rewritten = rewrite(text, {
    WRAP_LAUNCHER_USER: userInfo().username,
    WRAP_LAUNCHER_HOME: w.home,
    WRAP_PATH: `${w.fakes}:/usr/bin:/bin`,
    WRAP_DOCKER_HOST: DOCKER_SOCKET,
    WRAP_STATE_DIR: w.state,
    WRAP_RUNUSER: join(w.fakes, 'runuser'),
    WRAP_TOKEN_DIR: w.tokens,
    WRAP_KEY_DIR: w.keys,
    WRAP_LOGIN: w.login,
  });
  writeFileSync(w.wrapper, rewritten, { mode: 0o755 });
  return w;
}

// Runs the wrapper with the hostile environment and the fakes first on PATH.
function runWrapper(w: World, args: string[]) {
  const r = spawnSync(bashExe as string, [w.wrapper, ...args], {
    env: { ...HOSTILE, PATH: `${w.fakes}:/usr/bin:/bin` },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// Installer world: copies of the installer, the wrapper and the sudoers rule in a temp runner dir,
// a fake visudo, id and install, and a temp root for GEL_ROOT.
function installWorld(visudoFails = false) {
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
  // install -o root -g root -m MODE SRC DST: the source is argument 7, the destination 8.
  writeExe(join(fakes, 'install'), `echo "install $*" >> '${calls}'\ncp "$7" "$8"`);
  return { src, fakes, root, calls, script: join(src, 'install-wrapper.sh') };
}

function runInstall(iw: ReturnType<typeof installWorld>) {
  const r = spawnSync(bashExe as string, [iw.script], {
    env: { ...HOSTILE, PATH: `${iw.fakes}:/usr/bin:/bin`, GEL_ROOT: iw.root },
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
    expect(runWrapper(ok, ['deploy-key', ID]).status).toBe(0);
    expect(readOr(ok.runuserLog)).toContain(`chown 1002:1002 ${ok.state}/${ID}/deploy-key`);
    const bad = makeWorld({ playFail: true });
    expect(runWrapper(bad, ['deploy-key', ID]).status).toBe(4);
    expect(readOr(bad.runuserLog)).not.toContain('chown');
  });

  it('keeps the interim chown line in the wrapper, marked for deletion with R-4', () => {
    const text = readFileSync(join(runnerDir, 'geldar-fleet-run'), 'utf8');
    expect(text).toContain('chown 1002:1002 "$WRAP_STATE_DIR/$id/deploy-key"');
    expect(text).toMatch(/Delete this line with R-4/);
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

  it('checks the sudoers rule with visudo, then installs both with the Contract modes', () => {
    const iw = installWorld();
    const r = runInstall(iw);
    expect(r.status, r.out).toBe(0);
    const srcRun = join(iw.src, 'geldar-fleet-run');
    const srcSudoers = join(iw.src, 'geldar-fleet-sudoers');
    const dstRun = join(iw.root, 'usr', 'local', 'sbin', 'geldar-fleet-run');
    const dstSudoers = join(iw.root, 'etc', 'sudoers.d', 'geldar-fleet');
    expect(readOr(iw.calls).split('\n').filter(Boolean)).toEqual([
      `visudo -cf ${srcSudoers}`,
      `install -o root -g root -m 0755 ${srcRun} ${dstRun}`,
      `install -o root -g root -m 0440 ${srcSudoers} ${dstSudoers}`,
    ]);
  });

  it('installs no sudoers rule when visudo refuses it', () => {
    const iw = installWorld(true);
    const r = runInstall(iw);
    expect(r.status).toBe(7);
    expect(existsSync(join(iw.root, 'etc', 'sudoers.d', 'geldar-fleet'))).toBe(false);
    expect(readOr(iw.calls)).not.toContain('install ');
  });
});
