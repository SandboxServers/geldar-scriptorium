import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { bashExe } from '../../launcher/test/harness.ts';
import { ciRequiresShells } from './bootstrap-helpers.ts';

// verify-confinement.sh (F-05b) run against fakes. The fake runuser stands in for the runner
// account: it answers each probe as a confined VM does, and the environment knobs below flip one
// answer at a time (a leak, a second sudo command, a wrapper that accepts a bad id, a failed
// positive control, NoNewPrivileges=yes). Nothing here reads the host's real /etc, sudo or units.
const here = dirname(fileURLToPath(import.meta.url));
const runnerDir = resolve(here, '..', 'runner');
const UNIT_PROBE = 'systemctl show geldar-runner -p ProtectSystem,ReadWritePaths,NoNewPrivileges';

// The probe names, in order, as the snapshot. A renamed or dropped probe fails here.
const PROBES = [
  'test -r /etc/shadow',
  'ls /home/*',
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
  '  *"/etc/shadow"*) [ "${FAKE_LEAK:-}" = shadow ] ;;',
  '  *"/etc/geldar/tokens/"*) [ "${FAKE_LEAK:-}" = token ] ;;',
  '  *"/etc/geldar/keys/"*) [ "${FAKE_LEAK:-}" = key ] ;;',
  '  *"/home/geldar/.claude/"*) [ "${FAKE_LEAK:-}" = login ] ;;',
  '  *"ls /home/"*) exit 2 ;;',
  '  *"sudo -n true"*) exit 1 ;;',
  '  *"sudo -n -l"*)',
  '    echo "    (root) NOPASSWD: /usr/local/sbin/geldar-fleet-run"',
  '    [ -z "${FAKE_SUDO_EXTRA:-}" ] || echo "    (root) NOPASSWD: /usr/bin/id"',
  '    ;;',
  '  *"sudo -n /usr/local/sbin/geldar-fleet-run check-secrets ag-probe-00"*)',
  '    exit "${FAKE_POSITIVE:-0}" ;;',
  '  *"geldar-fleet-run"*) [ -z "${FAKE_WRAPPER_ACCEPTS:-}" ] || exit 0; exit 2 ;;',
  '  *"id -nG"*) echo geldar-runner ;;',
  '  *": >> /var/log/geldar-hosts.log"*) exit 0 ;;',
  '  *) exit 1 ;;',
  'esac',
].join('\n');

const FAKE_SYSTEMCTL = [
  'echo ProtectSystem=strict',
  'echo ReadWritePaths=-/etc/geldar/placement',
  'echo "NoNewPrivileges=${FAKE_NNP:-no}"',
].join('\n');

const made: string[] = [];

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeExe(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

// Runs the copied verify script with the fakes first on PATH. The env holds only the knobs the
// test sets, so a stray variable in the caller cannot flip a probe.
function runVerify(knobs: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-f05b-conf-'));
  made.push(dir);
  const fakes = join(dir, 'fakes');
  mkdirSync(fakes);
  writeExe(join(fakes, 'runuser'), FAKE_RUNUSER);
  writeExe(join(fakes, 'systemctl'), FAKE_SYSTEMCTL);
  writeExe(join(fakes, 'id'), 'echo "${FAKE_UID:-0}"');
  const script = join(dir, 'verify-confinement.sh');
  copyFileSync(join(runnerDir, 'verify-confinement.sh'), script);
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

  // Each knob flips one probe: the run must print FAIL for that probe and exit 1.
  const CASES: [string, Record<string, string>][] = [
    ['test -r /etc/shadow', { FAKE_LEAK: 'shadow' }],
    ['test -r /etc/geldar/tokens/<any file>', { FAKE_LEAK: 'token' }],
    ['test -r /etc/geldar/keys/<any file>', { FAKE_LEAK: 'key' }],
    ['test -r <shared login>', { FAKE_LEAK: 'login' }],
    ['sudo -n -l', { FAKE_SUDO_EXTRA: '1' }],
    ['wrapper ../x', { FAKE_WRAPPER_ACCEPTS: '1' }],
    ['wrapper positive control: check-secrets ag-probe-00', { FAKE_POSITIVE: '2' }],
    [UNIT_PROBE, { FAKE_NNP: 'yes' }],
  ];
  for (const [probe, knobs] of CASES) {
    it(`prints FAIL for "${probe}" and exits 1`, () => {
      const r = runVerify(knobs);
      expect(r.status, r.out).toBe(1);
      expect(r.lines, r.out).toContain(`FAIL ${probe}`);
    });
  }
});
