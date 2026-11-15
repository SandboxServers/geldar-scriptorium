import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { bashExe, bashPath } from '../../launcher/test/harness.ts';

// The guard of launcher/test/core.test.ts, copied as is: any truthy CI makes a missing shell fail.
function ciRequiresShells(ci: string | undefined): boolean {
  return ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false';
}

const here = dirname(fileURLToPath(import.meta.url));
const runnerDir = resolve(here, '..', 'runner');
const URL_OK = 'https://github.com/example-org/example-repo';
const TOKEN = 'test-registration-token';
const DEFAULT_PASSWD = 'geldar-runner:x:1002:1002::/opt/geldar-runner:/usr/sbin/nologin\n';

// The unit snapshot: geldar-runner.service must equal this text byte for byte.
const UNIT_SNAPSHOT = [
  '[Unit]',
  'Description=GitHub Actions runner for the geldar fleet (label geldar-hosts)',
  'After=network-online.target',
  'Wants=network-online.target',
  '',
  '[Service]',
  'User=geldar-runner',
  'WorkingDirectory=/opt/geldar-runner',
  'ExecStart=/opt/geldar-runner/run.sh',
  'Restart=always',
  'KillMode=process',
  'Environment=PATH=/usr/local/bin:/usr/bin:/bin',
  'ProtectHome=yes',
  'PrivateTmp=yes',
  'ProtectSystem=strict',
  'ReadWritePaths=-/etc/geldar/placement',
  'ReadWritePaths=-/var/log/geldar-hosts.log',
  'ReadWritePaths=-/run/geldar-fleet',
  'ReadWritePaths=-/opt/geldar-runner',
  'ReadWritePaths=-/run/sudo',
  '',
  '[Install]',
  'WantedBy=multi-user.target',
  '',
].join('\n');

// Fake commands for the script's PATH. Each logs its name and argv to $FAKE_STATE/calls.log; state
// files in $FAKE_STATE steer them. The fake tar unpacks the payload config.sh into the directory.
// The fake id answers -u with the uid and -nG with the names in runner-groups.
const FAKE_BODIES: Record<string, string> = {
  id: 'if [ "$1" = "-nG" ]; then cat "$FAKE_STATE/runner-groups"; else cat "$FAKE_STATE/uid"; fi',
  getent: 'grep "^$2:" "$FAKE_STATE/passwd"',
  useradd: [
    'echo "useradd $*" >> "$FAKE_STATE/calls.log"',
    'cat "$FAKE_STATE/passwd-line" >> "$FAKE_STATE/passwd"',
  ].join('\n'),
  systemctl: 'echo "systemctl $*" >> "$FAKE_STATE/calls.log"',
  chown: 'echo "chown $*" >> "$FAKE_STATE/calls.log"',
  curl: [
    'echo "curl $*" >> "$FAKE_STATE/calls.log"',
    'prev=""',
    'for a in "$@"; do if [ "$prev" = "-o" ]; then echo "fake tarball" > "$a"; fi; prev=$a; done',
  ].join('\n'),
  sha256sum: [
    'echo "sha256sum $*" >> "$FAKE_STATE/calls.log"',
    'cat > "$FAKE_STATE/sha-input"',
    '[ ! -e "$FAKE_STATE/sha-bad" ] || exit 1',
  ].join('\n'),
  tar: [
    'echo "tar $*" >> "$FAKE_STATE/calls.log"',
    'prev=""',
    'for a in "$@"; do',
    '  if [ "$prev" = "-C" ]; then cp "$FAKE_STATE/payload/config.sh" "$a/config.sh"; fi',
    '  prev=$a',
    'done',
  ].join('\n'),
  runuser: [
    'echo "runuser $*" >> "$FAKE_STATE/calls.log"',
    'FAKE_RUN_AS=$2',
    'export FAKE_RUN_AS',
    'shift 3',
    'exec "$@"',
  ].join('\n'),
};

// The payload config.sh records its argv, the account it ran as and its ACTIONS_RUNNER_INPUT_ env.
const CONFIG_BODY = [
  'echo "argv: $*" >> "$FAKE_STATE/config.log"',
  'echo "run-as: $FAKE_RUN_AS" >> "$FAKE_STATE/config.log"',
  'env | grep "^ACTIONS_RUNNER_INPUT_" >> "$FAKE_STATE/config.log"',
].join('\n');

// The log-only variants used by the seam test: they record the paths they are given and touch
// nothing, so a run with the seam ignored cannot write to the real /opt or /etc.
const LOG_ONLY: Record<string, string> = {
  mkdir: 'echo "mkdir $*" >> "$FAKE_STATE/calls.log"',
  cp: 'echo "cp $*" >> "$FAKE_STATE/calls.log"',
  chmod: 'echo "chmod $*" >> "$FAKE_STATE/calls.log"',
  tar: 'echo "tar $*" >> "$FAKE_STATE/calls.log"',
  runuser: 'echo "runuser $*" >> "$FAKE_STATE/calls.log"',
};

interface Setup {
  edits?: Record<string, string>; // versions.env keys to replace in the temp copy
  token?: string | null; // the token file's text; null leaves no token file at all
  runnerGroups?: string; // what id -nG reports for the runner account; default geldar-runner
  noAccount?: boolean; // the passwd fixture has no geldar-runner account
  shaBad?: boolean; // sha256sum reports a mismatch
  pathsLogOnly?: boolean; // mkdir, cp, chmod, tar and runuser only log; the runner dir exists
  hasConfig?: boolean; // the runner dir already holds config.sh (a re-run)
  hasRunner?: boolean; // the runner dir already holds .runner (registered)
  uid?: string; // what the fake id reports; default 0
}

interface World {
  dir: string;
  runner: string; // the temp copy of fleet/runner, next to install-runner.sh
  root: string; // the GEL_ROOT tree
  state: string;
  fakes: string;
  token: string;
  script: string;
}

const made: string[] = [];

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeExe(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

// A temp copy of fleet/runner (the script reads versions.env and the unit next to itself), a
// GEL_ROOT tree, the fakes and their fixtures. The repo's files are never edited by a test.
function makeWorld(setup: Setup = {}): World {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-f05a-'));
  made.push(dir);
  const world: World = {
    dir,
    runner: join(dir, 'runner'),
    root: join(dir, 'root'),
    state: join(dir, 'state'),
    fakes: join(dir, 'fakes'),
    token: join(dir, 'token'),
    script: join(dir, 'runner', 'install-runner.sh'),
  };
  const payload = join(world.state, 'payload');
  for (const d of [world.runner, world.state, world.fakes, payload]) {
    mkdirSync(d, { recursive: true });
  }
  copyFileSync(join(runnerDir, 'install-runner.sh'), world.script);
  copyFileSync(
    join(runnerDir, 'geldar-runner.service'),
    join(world.runner, 'geldar-runner.service'),
  );
  let versions = readFileSync(join(runnerDir, 'versions.env'), 'utf8');
  for (const [key, value] of Object.entries(setup.edits ?? {})) {
    versions = versions.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
  }
  writeFileSync(join(world.runner, 'versions.env'), versions);
  const bodies = { ...FAKE_BODIES, ...(setup.pathsLogOnly ? LOG_ONLY : {}) };
  for (const [name, body] of Object.entries(bodies)) writeExe(join(world.fakes, name), body);
  writeExe(join(payload, 'config.sh'), CONFIG_BODY);
  writeFileSync(join(world.state, 'uid'), setup.uid ?? '0');
  writeFileSync(join(world.state, 'passwd'), setup.noAccount ? '' : DEFAULT_PASSWD);
  writeFileSync(join(world.state, 'passwd-line'), DEFAULT_PASSWD);
  writeFileSync(join(world.state, 'runner-groups'), `${setup.runnerGroups ?? 'geldar-runner'}\n`);
  if (setup.shaBad) writeFileSync(join(world.state, 'sha-bad'), '');
  const tokenText = setup.token === undefined ? `${TOKEN}\n` : setup.token;
  if (tokenText !== null) writeFileSync(world.token, tokenText);
  const runnerHome = join(world.root, 'opt', 'geldar-runner');
  if (setup.pathsLogOnly || setup.hasConfig || setup.hasRunner) {
    mkdirSync(runnerHome, { recursive: true });
  }
  if (setup.hasConfig) writeExe(join(runnerHome, 'config.sh'), CONFIG_BODY);
  if (setup.hasRunner) writeFileSync(join(runnerHome, '.runner'), '{}\n');
  return world;
}

// Runs the copied script with the fakes first on PATH. GELDAR_INTERNAL=1 turns the GEL_ROOT seam
// on unless seam is false.
function run(world: World, opts: { seam?: boolean; args?: string[] } = {}) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.toUpperCase() === 'PATH' || k.startsWith('GEL')) continue;
    env[k] = v;
  }
  env.PATH = `${bashPath(world.fakes)}:/usr/bin:/bin`;
  env.FAKE_STATE = bashPath(world.state);
  env.GEL_ROOT = bashPath(world.root);
  if (opts.seam !== false) env.GELDAR_INTERNAL = '1';
  const args = opts.args ?? ['--url', URL_OK, '--token-file', bashPath(world.token)];
  const r = spawnSync(bashExe as string, [bashPath(world.script), ...args], {
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function readLog(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function calls(world: World): string[] {
  return readLog(join(world.state, 'calls.log')).split('\n').filter(Boolean);
}

function configLog(world: World): string {
  return readLog(join(world.state, 'config.log'));
}

// The tarball path the script fetched: the -o argument of its curl call.
function tarballOf(world: World): string {
  const argv = (calls(world).find((c) => c.startsWith('curl ')) ?? '').split(' ');
  return argv[argv.indexOf('-o') + 1] ?? '';
}

// The runner directory under the GEL_ROOT tree, as the script names it in its calls.
function runnerDirOf(world: World): string {
  return bashPath(join(world.root, 'opt', 'geldar-runner'));
}

// The fakes are extensionless scripts on PATH; Git Bash on win32 does not run them, so the suite
// runs on Linux (and in CI) and skips on win32 with the reason.
const win = process.platform === 'win32';
const skipReason = win
  ? 'fake commands need POSIX exec bits (win32)'
  : bashExe
    ? ''
    : 'bash is missing';
if (skipReason) {
  if (!win && ciRequiresShells(process.env.CI)) {
    throw new Error(`runner install tests cannot run under CI: ${skipReason}`);
  }
  console.warn(`SKIPPED: ${skipReason}; runner install tests did not run`);
}
const describeBash = skipReason ? describe.skip : describe;

describeBash('runner install (F-05a)', () => {
  it('installs the unit snapshot, which has no NoNewPrivileges', () => {
    const world = makeWorld();
    const r = run(world);
    expect(r.status, r.out).toBe(0);
    const installed = readFileSync(
      join(world.root, 'etc', 'systemd', 'system', 'geldar-runner.service'),
      'utf8',
    );
    expect(installed).toBe(UNIT_SNAPSHOT);
    expect(readFileSync(join(runnerDir, 'geldar-runner.service'), 'utf8')).toBe(UNIT_SNAPSHOT);
    expect(installed).not.toMatch(/NoNewPrivileges/);
    expect(calls(world)).toContain('systemctl enable --now geldar-runner.service');
  });

  it('checks the tarball against the pinned sha256 before it is unpacked', () => {
    const world = makeWorld();
    expect(run(world).status).toBe(0);
    const versions = readFileSync(join(runnerDir, 'versions.env'), 'utf8');
    const pinned = /^RUNNER_SHA256=(.*)$/m.exec(versions)?.[1];
    expect(pinned).toMatch(/^[0-9a-f]{64}$/);
    const checked = readLog(join(world.state, 'sha-input'));
    expect(checked).toBe(`${pinned}  ${tarballOf(world)}\n`);
  });

  it('unpacks the tarball into the runner directory with tar -xzf', () => {
    const world = makeWorld();
    expect(run(world).status).toBe(0);
    const dirArg = runnerDirOf(world);
    expect(calls(world)).toContain(`tar -xzf ${tarballOf(world)} -C ${dirArg}`);
  });

  it('gives the runner directory to the runner account', () => {
    const world = makeWorld();
    expect(run(world).status).toBe(0);
    expect(calls(world)).toContain(`chown -R geldar-runner:geldar-runner ${runnerDirOf(world)}`);
  });

  it('a FILL_ME checksum exits 5 before anything is fetched or unpacked', () => {
    const world = makeWorld({ edits: { RUNNER_SHA256: 'FILL_ME' } });
    const r = run(world);
    expect(r.status, r.out).toBe(5);
    expect(r.out).toContain('FILL_ME');
    expect(calls(world)).toEqual([]);
  });

  it('a malformed checksum exits 5 before the download', () => {
    const world = makeWorld({ edits: { RUNNER_SHA256: 'not-a-sha256' } });
    const r = run(world);
    expect(r.status, r.out).toBe(5);
    expect(calls(world).some((c) => c.startsWith('curl '))).toBe(false);
  });

  it('a FILL_ME version exits 5 before the download', () => {
    const world = makeWorld({ edits: { RUNNER_VERSION: 'FILL_ME' } });
    const r = run(world);
    expect(r.status, r.out).toBe(5);
    expect(calls(world)).toEqual([]);
  });

  it('a checksum mismatch exits 5 and nothing is unpacked', () => {
    const world = makeWorld({ shaBad: true });
    const r = run(world);
    expect(r.status, r.out).toBe(5);
    expect(calls(world).some((c) => c.startsWith('sha256sum '))).toBe(true);
    expect(calls(world).some((c) => c.startsWith('tar '))).toBe(false);
    expect(configLog(world)).toBe('');
  });

  it('the custom label is exactly geldar-hosts', () => {
    const world = makeWorld();
    expect(run(world).status).toBe(0);
    expect(configLog(world)).toContain('ACTIONS_RUNNER_INPUT_LABELS=geldar-hosts\n');
    expect(configLog(world)).toContain('run-as: geldar-runner\n');
  });

  it('the token reaches config.sh through its environment, never argv or output', () => {
    const world = makeWorld();
    const r = run(world);
    expect(r.status, r.out).toBe(0);
    expect(configLog(world)).toContain(`ACTIONS_RUNNER_INPUT_TOKEN=${TOKEN}\n`);
    const argv = configLog(world)
      .split('\n')
      .filter((l) => l.startsWith('argv: '));
    expect(argv).toEqual(['argv: --unattended --replace']);
    expect(calls(world).join('\n')).not.toContain(TOKEN);
    expect(r.out).not.toContain(TOKEN);
  });

  it.each(['docker', 'sudo', 'wheel'])('refuses the account in %s (exit 6)', (group) => {
    const world = makeWorld({ runnerGroups: `geldar-runner ${group}` });
    const r = run(world);
    expect(r.status, r.out).toBe(6);
    expect(configLog(world)).toBe('');
    expect(calls(world).some((c) => c.startsWith('runuser '))).toBe(false);
  });

  it('refuses the account whose primary group is docker (exit 6)', () => {
    const world = makeWorld({ runnerGroups: 'docker' });
    const r = run(world);
    expect(r.status, r.out).toBe(6);
    expect(configLog(world)).toBe('');
    expect(calls(world).some((c) => c.startsWith('runuser '))).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['two lines', `${TOKEN}\nsecond\n`],
    ['a CR', `${TOKEN}\r\n`],
  ])('refuses a token file that is %s (exit 2) before anything runs', (_, token) => {
    const world = makeWorld({ token });
    const r = run(world);
    expect(r.status, r.out).toBe(2);
    expect(calls(world)).toEqual([]);
  });

  it('skips the download when config.sh is already there, and still registers', () => {
    const world = makeWorld({ hasConfig: true });
    const r = run(world);
    expect(r.status, r.out).toBe(0);
    expect(calls(world).some((c) => c.startsWith('curl '))).toBe(false);
    expect(calls(world).some((c) => c.startsWith('tar '))).toBe(false);
    expect(configLog(world)).toContain('run-as: geldar-runner\n');
  });

  it('skips the registration when .runner is there, and still chowns the directory', () => {
    const world = makeWorld({ hasConfig: true, hasRunner: true });
    const r = run(world);
    expect(r.status, r.out).toBe(0);
    expect(calls(world).some((c) => c.startsWith('curl '))).toBe(false);
    expect(calls(world).some((c) => c.startsWith('runuser '))).toBe(false);
    expect(configLog(world)).toBe('');
    expect(calls(world)).toContain(`chown -R geldar-runner:geldar-runner ${runnerDirOf(world)}`);
  });

  it('creates the runner account when it is absent', () => {
    const world = makeWorld({ noAccount: true });
    expect(run(world).status).toBe(0);
    expect(calls(world)).toContain(
      'useradd --system --home-dir /opt/geldar-runner --shell /usr/sbin/nologin geldar-runner',
    );
  });

  it('refuses a URL that is not a GitHub repo, with nothing run (exit 2)', () => {
    const world = makeWorld();
    const args = ['--url', 'https://example.com/org/repo', '--token-file', world.token];
    expect(run(world, { args }).status).toBe(2);
    expect(calls(world)).toEqual([]);
  });

  it('refuses a missing token file (exit 2) and a run that is not root (exit 2)', () => {
    const noToken = makeWorld({ token: null });
    expect(run(noToken).status).toBe(2);
    expect(calls(noToken)).toEqual([]);
    const notRoot = makeWorld({ uid: '1000' });
    expect(run(notRoot).status).toBe(2);
    expect(calls(notRoot)).toEqual([]);
  });

  it('ignores GEL_ROOT without GELDAR_INTERNAL=1 and uses it with it', () => {
    const on = makeWorld({ pathsLogOnly: true });
    expect(run(on).status).toBe(0);
    const unitCopy = `${bashPath(on.root)}/etc/systemd/system/geldar-runner.service`;
    expect(calls(on)).toContain(`cp ${bashPath(on.runner)}/geldar-runner.service ${unitCopy}`);
    const off = makeWorld({ pathsLogOnly: true });
    run(off, { seam: false });
    const offCalls = calls(off);
    expect(offCalls.some((c) => c.startsWith('tar ') && c.endsWith(' -C /opt/geldar-runner'))).toBe(
      true,
    );
    expect(offCalls.join('\n')).not.toContain(bashPath(off.root));
  });
});
