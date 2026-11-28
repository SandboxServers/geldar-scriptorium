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
import { bashExe } from '../../launcher/test/harness.ts';
import { ciRequiresShells } from './bootstrap-helpers.ts';

// The root installer (F-05b, install-wrapper.sh) run against fakes: a fake id, visudo, stat, mkdir,
// mv and install, all logging their arguments. The installer's GEL_ROOT seam is set only with
// GELDAR_INTERNAL=1, so the real /usr and /etc are never written.
const here = dirname(fileURLToPath(import.meta.url));
const runnerDir = resolve(here, '..', 'runner');
const SUDOERS_TEXT =
  'Defaults:geldar-runner env_reset,secure_path=/usr/local/bin:/usr/bin:/bin\n' +
  'geldar-runner ALL=(root) NOPASSWD: /usr/local/sbin/geldar-fleet-run\n';

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

interface InstallOpts {
  visudoFails?: boolean;
  mvFails?: boolean;
  owner?: number; // the uid the fake stat reports for both sources; 0 when unset
  mode?: string; // the octal mode the fake stat reports for both sources; 644 when unset
}

// Installer world: copies of the installer, the wrapper and the sudoers rule in a temp runner dir,
// fake commands, and a temp root for GEL_ROOT.
function installWorld(opts: InstallOpts = {}) {
  const { visudoFails = false, mvFails = false, owner = 0, mode = '644' } = opts;
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
  // stat answers the owner and mode of each source, as the installer reads them with stat -c.
  writeExe(join(fakes, 'stat'), `echo "${owner} ${mode}"`);
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

// The installer needs bash and POSIX exec bits: win32 skips with the reason.
const win = process.platform === 'win32';
const skipReason = win
  ? 'fake commands need POSIX exec bits (win32)'
  : bashExe
    ? ''
    : 'bash is missing';
if (skipReason) {
  if (!win && ciRequiresShells(process.env.CI)) {
    throw new Error(`root installer tests cannot run under CI: ${skipReason}`);
  }
  console.warn(`SKIPPED: ${skipReason}; root installer tests did not run`);
}
const describeBash = skipReason ? describe.skip : describe;

describeBash('root installer (F-05b)', () => {
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
    expect(readOr(dstSudoers)).toBe(SUDOERS_TEXT);
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

  // A source the runner account could have changed: a non-root owner, or a group or world write
  // bit. Each case must exit 2 before anything is made, installed or checked.
  const UNSAFE: [number, string][] = [
    [1001, '664'],
    [0, '664'],
    [0, '646'],
  ];
  for (const [owner, mode] of UNSAFE) {
    it(`refuses sources owned by ${owner} with mode ${mode}: exit 2, nothing installed`, () => {
      const iw = installWorld({ owner, mode });
      const r = runInstall(iw);
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('must be owned by root and not group or world writable');
      expect(readOr(iw.calls)).toBe('');
      expect(existsSync(join(iw.root, 'usr'))).toBe(false);
      expect(existsSync(join(iw.root, 'etc'))).toBe(false);
    });
  }
});
