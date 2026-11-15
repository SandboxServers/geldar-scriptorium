import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { bashExe } from '../../launcher/test/harness.ts';
import { ciRequiresShells } from './bootstrap-helpers.ts';

// verify-confinement.sh (F-05b) run against fakes. The fake runuser stands in for the runner
// account: it answers each probe as a confined VM does, and the environment knobs below flip one
// answer at a time (a leak, a second sudo command, a wrapper that accepts a bad id, a failed
// positive control, NoNewPrivileges=yes, and each refused probe allowed). The script's target paths
// are rewritten to a temp world, so nothing here reads the host's real /etc, sudo or units.
const here = dirname(fileURLToPath(import.meta.url));
const runnerDir = resolve(here, '..', 'runner');
const UNIT_PROBE = 'systemctl show geldar-runner -p ProtectSystem,ReadWritePaths,NoNewPrivileges';

// The probe names, in order, as the snapshot. A renamed or dropped probe fails here.
const PROBES = [
  'runuser -u geldar-runner -- true',
  'test -r /etc/shadow',
  'ls /home/<each entry>',
  'sudo -n true',
  'sudo -n -l',
  'test -w /etc/geldar/keys',
  'test -r /etc/geldar/tokens/<any file>',
  'test -r /etc/geldar/keys/<any file>',
  'test -r <shared login>',
  'append /var/log/geldar-hosts.log',
  'id -nG has no docker, sudo or wheel',
  'docker ps',
  'wrapper AG-x',
  'wrapper ag-a;b',
  'wrapper ag-x$(id)',
  'wrapper ag-x b',
  'wrapper ../x',
  'wrapper verb bash',
  'wrapper verb exec',
  'wrapper verb start;id',
  'wrapper flag --rm',
  'wrapper positive control: check-secrets ag-probe-00',
  UNIT_PROBE,
];

const FAKE_RUNUSER = [
  'shift 3',
  'case "$*" in',
  '  true) [ -z "${FAKE_RUNNER_DOWN:-}" ] ;;',
  '  *"/etc/shadow"*) [ -z "${FAKE_RC:-}" ] || exit "$FAKE_RC"; [ "${FAKE_LEAK:-}" = shadow ] ;;',
  '  *"/etc/geldar/tokens/"*) [ "${FAKE_LEAK:-}" = token ] ;;',
  '  *"/etc/geldar/keys/"*) [ "${FAKE_LEAK:-}" = key ] ;;',
  '  *"/home/geldar/.claude/"*) [ "${FAKE_LEAK:-}" = login ] ;;',
  '  ls *) [ -n "${FAKE_HOME:-}" ] ;;',
  '  *"sudo -n true"*) [ -n "${FAKE_SUDO_TRUE:-}" ] ;;',
  '  *"sudo -n -l"*)',
  '    echo "    (root) NOPASSWD: /usr/local/sbin/geldar-fleet-run"',
  '    [ -z "${FAKE_SUDO_EXTRA:-}" ] || echo "    (root) NOPASSWD: /usr/bin/id"',
  '    [ -z "${FAKE_SUDO_PASSWD:-}" ] || echo "    (root) /usr/bin/id"',
  '    ;;',
  '  *"test -w "*) [ -n "${FAKE_WRITE:-}" ] ;;',
  '  *"sudo -n /usr/local/sbin/geldar-fleet-run check-secrets ag-probe-00"*)',
  '    exit "${FAKE_POSITIVE:-0}" ;;',
  '  *"geldar-fleet-run"*)',
  '    [ -z "${FAKE_WRAPPER_ACCEPTS:-}" ] || exit 0',
  '    [ -n "${FAKE_WRAPPER_BARE:-}" ] || echo "geldar-fleet-run: refused" >&2',
  '    exit 2',
  '    ;;',
  '  *"id -nG"*) echo "geldar-runner ${FAKE_GROUPS:-}" ;;',
  '  *": >> "*) [ -z "${FAKE_NO_APPEND:-}" ] ;;',
  '  *"docker ps"*)',
  '    [ -z "${FAKE_DOCKER:-}" ] || exit 0',
  '    if [ -n "${FAKE_DOCKER_ERR:-}" ]; then',
  '      echo "docker: not found" >&2',
  '    else',
  '      echo "permission denied" >&2',
  '    fi',
  '    exit 1',
  '    ;;',
  '  *) exit 1 ;;',
  'esac',
].join('\n');

const FAKE_SYSTEMCTL = [
  'echo ProtectSystem=strict',
  'echo ReadWritePaths=-/etc/geldar/placement',
  'echo "NoNewPrivileges=${FAKE_NNP:-no}"',
].join('\n');

// The runner account exists unless FAKE_NO_RUNNER is set; the script's own root check gets FAKE_UID.
const FAKE_ID = [
  'case "$*" in',
  '  *geldar-runner*) [ -z "${FAKE_NO_RUNNER:-}" ] ;;',
  '  *) echo "${FAKE_UID:-0}" ;;',
  'esac',
].join('\n');

const made: string[] = [];

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeExe(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

// Rewrites each named readonly constant of the verify script. A name that is not found throws, so
// a test can never fall through to the real /etc or /home paths.
function rewriteConsts(text: string, values: Record<string, string>): string {
  let out = text;
  for (const [name, value] of Object.entries(values)) {
    const re = new RegExp(`^readonly ${name}=.*$`, 'm');
    if (!re.test(out)) throw new Error(`the verify script has no constant ${name}`);
    out = out.replace(re, () => `readonly ${name}=${value}`);
  }
  return out;
}

// Runs the copied verify script in a temp world with the fakes first on PATH. The env holds only
// the knobs the test sets, so a stray variable in the caller cannot flip a probe. `missing` lists
// world paths (relative to the root) the test removes, to exercise the root-side precondition.
function runVerify(knobs: Record<string, string> = {}, missing: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-f05b-conf-'));
  made.push(dir);
  const fakes = join(dir, 'fakes');
  const root = join(dir, 'root');
  mkdirSync(fakes);
  for (const d of ['etc/geldar/tokens', 'etc/geldar/keys', 'home/geldar/.claude', 'var/log']) {
    mkdirSync(join(root, d), { recursive: true });
  }
  writeFileSync(join(root, 'etc/shadow'), 'shadow\n');
  writeFileSync(join(root, 'etc/geldar/tokens/ag-probe-00.token'), 'token\n');
  writeFileSync(join(root, 'etc/geldar/keys/ag-probe-00'), 'key\n');
  writeFileSync(join(root, 'home/geldar/.claude/.credentials.json'), '{}\n');
  for (const m of missing) rmSync(join(root, m), { recursive: true, force: true });
  writeExe(join(fakes, 'runuser'), FAKE_RUNUSER);
  writeExe(join(fakes, 'systemctl'), FAKE_SYSTEMCTL);
  writeExe(join(fakes, 'id'), FAKE_ID);
  const script = join(dir, 'verify-confinement.sh');
  const text = readFileSync(join(runnerDir, 'verify-confinement.sh'), 'utf8');
  writeFileSync(
    script,
    rewriteConsts(text, {
      CONF_SHADOW: join(root, 'etc/shadow'),
      CONF_HOMES: join(root, 'home'),
      CONF_TOKEN_DIR: join(root, 'etc/geldar/tokens'),
      CONF_KEY_DIR: join(root, 'etc/geldar/keys'),
      CONF_LOGIN: join(root, 'home/geldar/.claude/.credentials.json'),
      CONF_LOG: join(root, 'var/log/geldar-hosts.log'),
    }),
    { mode: 0o755 },
  );
  const r = spawnSync(bashExe as string, [script], {
    env: { PATH: `${fakes}:/usr/bin:/bin`, ...knobs },
    encoding: 'utf8',
    timeout: 60_000,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { status: r.status, lines: (r.stdout ?? '').split('\n').filter(Boolean), out };
}

// The fakes are extensionless scripts on PATH; win32 cannot exec them, so the suite skips there.
const win = process.platform === 'win32';
const skipReason = win
  ? 'fake commands need POSIX exec bits (win32)'
  : bashExe
    ? ''
    : 'bash is missing';
if (skipReason) {
  if (!win && ciRequiresShells(process.env.CI)) {
    throw new Error(`confinement tests cannot run under CI: ${skipReason}`);
  }
  console.warn(`SKIPPED: ${skipReason}; confinement tests did not run`);
}
const describeBash = skipReason ? describe.skip : describe;

describeBash('runner confinement check (F-05b)', () => {
  it('prints ok for each probe in snapshot order and exits 0 on a confined runner', () => {
    const r = runVerify();
    expect(r.status, r.out).toBe(0);
    expect(r.lines).toEqual(PROBES.map((p) => `ok ${p}`));
  });

  it('refuses to run unless root', () => {
    const r = runVerify({ FAKE_UID: '1000' });
    expect(r.status).toBe(2);
    expect(r.lines).toEqual([]);
  });

  it('prints FAIL and exits 1 when the runner account is missing', () => {
    const r = runVerify({ FAKE_NO_RUNNER: '1' });
    expect(r.status).toBe(1);
    expect(r.lines).toEqual(['FAIL runner account geldar-runner is missing']);
  });

  it('prints FAIL with a precondition note, not ok, when a refused probe has no target', () => {
    const r = runVerify({}, ['etc/geldar/tokens/ag-probe-00.token']);
    expect(r.status).toBe(1);
    const probe = 'FAIL test -r /etc/geldar/tokens/<any file> (precondition: ';
    expect(r.lines.some((l) => l.startsWith(probe))).toBe(true);
    expect(r.lines).not.toContain('ok test -r /etc/geldar/tokens/<any file>');
  });

  it('prints FAIL for the home probe when /home has no entry, and exits 1', () => {
    const r = runVerify({}, ['home/geldar']);
    expect(r.status).toBe(1);
    const probe = 'FAIL ls /home/<each entry> (precondition: ';
    expect(r.lines.some((l) => l.startsWith(probe))).toBe(true);
  });

  // Each knob flips one probe: the run must print FAIL for that probe and exit 1.
  const CASES: [string, Record<string, string>][] = [
    ['runuser -u geldar-runner -- true', { FAKE_RUNNER_DOWN: '1' }],
    ['test -r /etc/shadow', { FAKE_LEAK: 'shadow' }],
    ['test -r /etc/shadow', { FAKE_RC: '125' }],
    ['test -r /etc/shadow', { FAKE_RC: '126' }],
    ['test -r /etc/shadow', { FAKE_RC: '127' }],
    ['ls /home/<each entry>', { FAKE_HOME: '1' }],
    ['sudo -n true', { FAKE_SUDO_TRUE: '1' }],
    ['sudo -n -l', { FAKE_SUDO_EXTRA: '1' }],
    ['sudo -n -l', { FAKE_SUDO_PASSWD: '1' }],
    ['test -w /etc/geldar/keys', { FAKE_WRITE: '1' }],
    ['test -r /etc/geldar/tokens/<any file>', { FAKE_LEAK: 'token' }],
    ['test -r /etc/geldar/keys/<any file>', { FAKE_LEAK: 'key' }],
    ['test -r <shared login>', { FAKE_LEAK: 'login' }],
    ['append /var/log/geldar-hosts.log', { FAKE_NO_APPEND: '1' }],
    ['id -nG has no docker, sudo or wheel', { FAKE_GROUPS: 'docker' }],
    ['docker ps', { FAKE_DOCKER: '1' }],
    ['docker ps', { FAKE_DOCKER_ERR: '1' }],
    ['wrapper ../x', { FAKE_WRAPPER_ACCEPTS: '1' }],
    ['wrapper ../x', { FAKE_WRAPPER_BARE: '1' }],
    ['wrapper positive control: check-secrets ag-probe-00', { FAKE_POSITIVE: '2' }],
    [UNIT_PROBE, { FAKE_NNP: 'yes' }],
  ];
  for (const [probe, knobs] of CASES) {
    it(`prints FAIL for "${probe}" when ${JSON.stringify(knobs)}, and exits 1`, () => {
      const r = runVerify(knobs);
      expect(r.status, r.out).toBe(1);
      expect(r.lines, r.out).toContain(`FAIL ${probe}`);
    });
  }
});
