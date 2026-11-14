import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { bashExe, bashPath } from '../../launcher/test/harness.ts';

// The guard of launcher/test/core.test.ts, copied as is: any truthy CI makes a missing shell a failure.
function ciRequiresShells(ci: string | undefined): boolean {
  return ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false';
}

const here = dirname(fileURLToPath(import.meta.url));
const bootstrapDir = resolve(here, '..', 'bootstrap');
const SHA256 = 'f3d8f9bb23ae392374e91cd9d395970dabc5b9c5ee72f39884613cd84a6ed310';

// Fake commands for the script's PATH. Each logs its name and argv to $FAKE_STATE/calls.log
// (dpkg-query, id and the fake git are silent); state files in $FAKE_STATE steer them.
const FAKE_BODIES: Record<string, string> = {
  id: 'cat "$FAKE_STATE/uid"',
  'dpkg-query': [
    'for pkg in "$@"; do :; done',
    'grep -qx "$pkg" "$FAKE_STATE/apt-installed" 2>/dev/null && { echo "install ok installed"; exit 0; }',
    'exit 1',
  ].join('\n'),
  'apt-get': [
    'echo "apt-get $*" >> "$FAKE_STATE/calls.log"',
    'case " $* " in *" install "*) ;; *) exit 0 ;; esac',
    'for a in "$@"; do case "$a" in -*|install) ;; *) echo "$a" >> "$FAKE_STATE/apt-installed" ;; esac; done',
  ].join('\n'),
  curl: [
    'echo "curl $*" >> "$FAKE_STATE/calls.log"',
    'prev=""',
    'for a in "$@"; do if [ "$prev" = "-o" ]; then echo "fake tarball" > "$a"; fi; prev=$a; done',
  ].join('\n'),
  sha256sum: [
    'echo "sha256sum $*" >> "$FAKE_STATE/calls.log"',
    'cat "$2" >> "$FAKE_STATE/sha256.log"',
    '[ ! -e "$FAKE_STATE/sha-bad" ] || exit 1',
  ].join('\n'),
  tar: [
    'echo "tar $*" >> "$FAKE_STATE/calls.log"',
    'prev=""',
    'for a in "$@"; do if [ "$prev" = "-C" ]; then mkdir -p "$a/git-2.47.1"; fi; prev=$a; done',
  ].join('\n'),
  make: [
    'echo "make $*" >> "$FAKE_STATE/calls.log"',
    'case " $* " in *" install "*) cat "$FAKE_STATE/make-git" > "$FAKE_STATE/git-version" ;; esac',
  ].join('\n'),
};

// The VM's git at GEL_ROOT/usr/local/bin/git: reports the version in the state file.
const FAKE_GIT =
  'if [ "$1" = "--version" ]; then echo "git version $(cat "$FAKE_STATE/git-version")"; fi';

interface Setup {
  gitVersion?: string; // what the VM's git reports before the run
  makeGit?: string; // what the fake make installs
  uid?: string; // what the fake id reports
  shaBad?: boolean; // the fake sha256sum rejects the tarball
  edits?: Record<string, string>; // versions.env keys to replace in the temp copy
  noVersions?: boolean; // the temp copy has no versions.env at all
}

interface World {
  dir: string;
  root: string;
  state: string;
  fakes: string;
}

const made: string[] = [];

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeExe(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

// A temp copy of the script and versions.env (the script reads versions.env next to itself),
// a GEL_ROOT tree, and the fakes. The repo's files are never edited by a test.
function makeWorld(setup: Setup = {}): World {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-f01a-'));
  made.push(dir);
  const world = {
    dir,
    root: join(dir, 'root'),
    state: join(dir, 'state'),
    fakes: join(dir, 'fakes'),
  };
  const bootstrap = join(dir, 'bootstrap');
  for (const d of [bootstrap, join(world.root, 'usr', 'local', 'bin'), world.state, world.fakes]) {
    mkdirSync(d, { recursive: true });
  }
  copyFileSync(join(bootstrapDir, 'bootstrap-git.sh'), join(bootstrap, 'bootstrap-git.sh'));
  let versions = readFileSync(join(bootstrapDir, 'versions.env'), 'utf8');
  for (const [key, value] of Object.entries(setup.edits ?? {})) {
    versions = versions.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
  }
  if (!setup.noVersions) writeFileSync(join(bootstrap, 'versions.env'), versions);
  for (const [name, body] of Object.entries(FAKE_BODIES)) {
    writeExe(join(world.fakes, name), body);
  }
  writeExe(join(world.root, 'usr', 'local', 'bin', 'git'), FAKE_GIT);
  writeFileSync(join(world.state, 'git-version'), setup.gitVersion ?? '2.39.5');
  writeFileSync(join(world.state, 'make-git'), setup.makeGit ?? '2.47.1');
  writeFileSync(join(world.state, 'uid'), setup.uid ?? '0');
  writeFileSync(join(world.state, 'apt-installed'), '');
  if (setup.shaBad) writeFileSync(join(world.state, 'sha-bad'), '');
  return world;
}

// Runs the copied script. GELDAR_INTERNAL=1 turns the GEL_ROOT seam on unless seam is false.
function run(world: World, opts: { seam?: boolean } = {}) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.toUpperCase() === 'PATH' || k.startsWith('GEL')) continue;
    if (k === 'GELDAR_INTERNAL') continue;
    env[k] = v;
  }
  env.PATH = `${bashPath(world.fakes)}:/usr/bin:/bin`;
  env.FAKE_STATE = bashPath(world.state);
  env.GEL_ROOT = bashPath(world.root);
  if (opts.seam !== false) env.GELDAR_INTERNAL = '1';
  const r = spawnSync(
    bashExe as string,
    [bashPath(join(world.dir, 'bootstrap', 'bootstrap-git.sh'))],
    { env, encoding: 'utf8', timeout: 60_000 },
  );
  return { status: r.status, stderr: r.stderr ?? '' };
}

function calls(world: World): string[] {
  const log = join(world.state, 'calls.log');
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
}

const madeMake = (world: World) => calls(world).some((c) => c.startsWith('make '));

// Every file under dir with its content, so two runs can be compared exactly.
function snapshot(dir: string): string {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(`${relative(dir, p)}\t${readFileSync(p, 'utf8')}`);
    }
  };
  walk(dir);
  return out.join('\n');
}

it('bash is present, and a missing shell is a failure in CI', () => {
  if (!ciRequiresShells(process.env.CI)) {
    // Locally a missing shell is skipped visibly, never passed vacuously.
    if (!bashExe) console.warn('SKIPPED: bash is missing, bootstrap-git tests did not run');
    return;
  }
  expect(bashExe, 'bash is required when CI is set').toBeDefined();
});

// The fakes are extensionless scripts on PATH; Git Bash on win32 does not run them, so the
// suite runs on Linux (and in CI) and skips on win32 with the reason.
const win = process.platform === 'win32';
if (win)
  console.warn('SKIPPED: fake commands need POSIX exec bits; bootstrap-git tests did not run');
const describeBash = bashExe && !win ? describe : describe.skip;

describeBash('fleet/bootstrap/bootstrap-git.sh (F-01a)', () => {
  it('a second run changes nothing', () => {
    const world = makeWorld();
    expect(run(world).status).toBe(0);
    expect(madeMake(world)).toBe(true);
    expect(calls(world).find((c) => c.startsWith('apt-get install'))).toContain('shellcheck');
    const before = snapshot(world.state) + snapshot(world.root);
    expect(run(world).status).toBe(0);
    expect(snapshot(world.state) + snapshot(world.root)).toBe(before);
  }, 60_000);

  it('a bad checksum exits 5 and nothing is unpacked', () => {
    const world = makeWorld({ shaBad: true });
    const r = run(world);
    expect(r.status).toBe(5);
    expect(r.stderr).toContain('nothing unpacked');
    expect(calls(world).some((c) => c.startsWith('tar ') || c.startsWith('make '))).toBe(false);
  }, 60_000);

  it('the tarball is checked against the pinned GIT_SHA256', () => {
    const world = makeWorld();
    expect(run(world).status).toBe(0);
    const checked = readFileSync(join(world.state, 'sha256.log'), 'utf8');
    expect(checked).toContain(`${SHA256}  git.tar.xz`);
  }, 60_000);

  it.each([
    ['a short digest', { GIT_SHA256: SHA256.slice(0, 40) }],
    ['a non-hex digest', { GIT_SHA256: `${SHA256.slice(0, 63)}g` }],
  ])(
    '%s exits 5 before any step acts, nothing unpacked',
    (_name, edits) => {
      const world = makeWorld({ edits });
      const r = run(world);
      expect(r.status).toBe(5);
      expect(r.stderr).toContain('GIT_SHA256 is not a sha256 hex digest');
      expect(calls(world)).toEqual([]);
    },
    60_000,
  );

  it('a missing versions.env exits 5 and nothing is unpacked', () => {
    const world = makeWorld({ noVersions: true });
    const r = run(world);
    expect(r.status).toBe(5);
    expect(r.stderr).toContain('versions.env is missing');
    expect(calls(world)).toEqual([]);
  }, 60_000);

  it.each(['GIT_VERSION', 'GIT_URL', 'GIT_SHA256'])(
    '%s set to FILL_ME exits 5 with its own message before any step acts',
    (key) => {
      const world = makeWorld({ edits: { [key]: 'FILL_ME' } });
      const r = run(world);
      expect(r.status).toBe(5);
      expect(r.stderr).toContain(`${key} is still FILL_ME`);
      expect(calls(world)).toEqual([]);
    },
    60_000,
  );

  it('git 2.39 triggers the build', () => {
    const world = makeWorld({ gitVersion: '2.39.5' });
    expect(run(world).status).toBe(0);
    expect(calls(world).filter((c) => c.startsWith('make '))).toHaveLength(1);
  }, 60_000);

  it('git 2.47.1 skips the build', () => {
    const world = makeWorld({ gitVersion: '2.47.1' });
    expect(run(world).status).toBe(0);
    expect(madeMake(world)).toBe(false);
  }, 60_000);

  it('a newer git 2.48.0 is kept: the build is skipped', () => {
    const world = makeWorld({ gitVersion: '2.48.0' });
    expect(run(world).status).toBe(0);
    expect(madeMake(world)).toBe(false);
  }, 60_000);

  it('a final git 2.39 exits 6', () => {
    const world = makeWorld({ gitVersion: '2.39.5', makeGit: '2.39.5' });
    const r = run(world);
    expect(r.status).toBe(6);
    expect(r.stderr).toContain('need 2.47.1');
  }, 60_000);

  it('refuses to run as non-root', () => {
    const world = makeWorld({ uid: '1000' });
    expect(run(world).status).toBe(2);
    expect(calls(world)).toEqual([]);
  }, 60_000);

  it('ignores GEL_ROOT without GELDAR_INTERNAL=1', () => {
    // The fixture: the seam's git is 2.47.1, so only the seam path skips the build.
    const world = makeWorld({ gitVersion: '2.47.1' });
    expect(run(world).status).toBe(0);
    expect(madeMake(world)).toBe(false);
    // Without the seam the script reads the host's real /usr/local/bin/git, which this test
    // cannot control: when that file exists the seam-off half is skipped, with the reason.
    if (existsSync('/usr/local/bin/git')) {
      console.warn('SKIPPED: seam-off half: this host has /usr/local/bin/git, a real git is read');
      return;
    }
    run(world, { seam: false });
    expect(madeMake(world)).toBe(true);
  }, 60_000);
});
