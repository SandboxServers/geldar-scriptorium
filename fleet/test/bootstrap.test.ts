import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
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
const confDir = resolve(here, '..', 'conf');
const HOME = '/home/geldar';
// A commit that starts with the launcher's 79b28f7, and one that does not.
const CLONE_COMMIT = `79b28f7${'0'.repeat(33)}`;
const GROUPS = 'docker:x:999:\nsudo:x:27:\nwheel:x:10:\n';

// The VM's git at GEL_ROOT/usr/local/bin/git: always 2.47.1, so bootstrap-git.sh skips its build.
const ROOT_GIT = 'if [ "$1" = "--version" ]; then echo "git version 2.47.1"; fi';

// The git on PATH, which geldar and geldar-runner run through runuser. Its version comes from the
// state file; every other call is logged by name and argv, and the clone is faked as a directory.
const FAKE_GIT = [
  'case "$1" in',
  '  --version) echo "git version $(cat "$FAKE_STATE/git-version")" ;;',
  '  *)',
  '    echo "git $*" >> "$FAKE_STATE/calls.log"',
  '    case "$1" in',
  '      clone) for a in "$@"; do last=$a; done; mkdir -p "$last/.git" ;;',
  '      -C) if [ "$3" = rev-parse ]; then cat "$FAKE_STATE/clone-commit"; fi ;;',
  '    esac ;;',
  'esac',
].join('\n');

// Fake commands for the script's PATH. Mutating calls are logged to $FAKE_STATE/calls.log; the
// account and group databases are fixtures in $FAKE_STATE.
const FAKE_BODIES: Record<string, string> = {
  id: 'cat "$FAKE_STATE/uid"',
  'dpkg-query': 'echo "install ok installed"',
  // Never a network call: bootstrap-git.sh would only fetch git when the VM has none.
  curl: 'exit 1',
  getent: [
    'case "$1" in',
    '  passwd) grep "^$2:" "$FAKE_STATE/passwd" || exit 2 ;;',
    '  group) shift; for k in "$@"; do grep "^$k:" "$FAKE_STATE/group" || true; done ;;',
    'esac',
  ].join('\n'),
  useradd: [
    'echo "useradd $*" >> "$FAKE_STATE/calls.log"',
    'for a in "$@"; do last=$a; done',
    'echo "$last:x:998:998::/opt/geldar-runner:/usr/sbin/nologin" >> "$FAKE_STATE/passwd"',
  ].join('\n'),
  mount: 'echo "mount $*" >> "$FAKE_STATE/calls.log"',
  chown: 'echo "chown $*" >> "$FAKE_STATE/calls.log"',
  // runuser -u NAME -- COMMAND...: logs the call and runs COMMAND as the current user.
  runuser: 'echo "runuser $*" >> "$FAKE_STATE/calls.log"; shift 3; exec "$@"',
  git: FAKE_GIT,
};

interface Setup {
  gitVersion?: string; // what the PATH git (run by geldar and geldar-runner) reports
  uid?: string; // what the fake id reports
  edits?: Record<string, string>; // versions.env keys to replace in the temp copy
  noGeldar?: boolean; // the passwd fixture has no geldar account
  noBin?: boolean; // the temp fleet tree has no bin/, so the install and clone are skipped
  cloneCommit?: string; // what the fake git reports for the clone's HEAD
  groups?: string; // the group fixture for docker, sudo and wheel
  fleetConf?: string; // an existing fleet.conf in the temp GEL_ROOT tree
}

interface World {
  dir: string;
  fleet: string;
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

// A temp copy of the fleet tree (the script reads versions.env and conf/ next to itself), a
// GEL_ROOT tree, the fakes and their fixtures. The repo's files are never edited by a test.
function makeWorld(setup: Setup = {}): World {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-f01b-'));
  made.push(dir);
  const world: World = {
    dir,
    fleet: join(dir, 'fleet'),
    root: join(dir, 'root'),
    state: join(dir, 'state'),
    fakes: join(dir, 'fakes'),
  };
  const bootstrap = join(world.fleet, 'bootstrap');
  for (const d of [
    bootstrap,
    join(world.fleet, 'conf'),
    world.state,
    world.fakes,
    join(world.root, 'usr', 'local', 'bin'),
  ]) {
    mkdirSync(d, { recursive: true });
  }
  copyFileSync(join(bootstrapDir, 'bootstrap.sh'), join(bootstrap, 'bootstrap.sh'));
  copyFileSync(join(bootstrapDir, 'bootstrap-git.sh'), join(bootstrap, 'bootstrap-git.sh'));
  let versions = readFileSync(join(bootstrapDir, 'versions.env'), 'utf8');
  for (const [key, value] of Object.entries(setup.edits ?? {})) {
    versions = versions.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
  }
  writeFileSync(join(bootstrap, 'versions.env'), versions);
  copyFileSync(
    join(confDir, 'fleet.conf.example'),
    join(world.fleet, 'conf', 'fleet.conf.example'),
  );
  writeFileSync(join(world.fleet, 'conf', 'allowed-repos.txt'), 'example-org/player-ag-*\n');
  if (!setup.noBin) {
    mkdirSync(join(world.fleet, 'bin'));
    writeFileSync(join(world.fleet, 'bin', 'place.sh'), '#!/usr/bin/env bash\n');
  }
  for (const [name, body] of Object.entries(FAKE_BODIES)) {
    writeExe(join(world.fakes, name), body);
  }
  writeExe(join(world.root, 'usr', 'local', 'bin', 'git'), ROOT_GIT);
  writeFileSync(join(world.state, 'uid'), setup.uid ?? '0');
  writeFileSync(join(world.state, 'git-version'), setup.gitVersion ?? '2.47.1');
  writeFileSync(join(world.state, 'clone-commit'), setup.cloneCommit ?? CLONE_COMMIT);
  writeFileSync(
    join(world.state, 'passwd'),
    setup.noGeldar ? '' : `geldar:x:1001:1001::${HOME}:/bin/bash\n`,
  );
  writeFileSync(join(world.state, 'group'), setup.groups ?? GROUPS);
  if (setup.fleetConf !== undefined) {
    mkdirSync(join(world.root, 'etc', 'geldar'), { recursive: true });
    writeFileSync(join(world.root, 'etc', 'geldar', 'fleet.conf'), setup.fleetConf);
  }
  return world;
}

// Runs the copied script. GELDAR_INTERNAL=1 turns the GEL_ROOT seam on unless seam is false.
function run(world: World, opts: { seam?: boolean } = {}) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.toUpperCase() === 'PATH' || k.startsWith('GEL')) continue;
    env[k] = v;
  }
  env.PATH = `${bashPath(world.fakes)}:/usr/bin:/bin`;
  env.FAKE_STATE = bashPath(world.state);
  env.GEL_ROOT = bashPath(world.root);
  if (opts.seam !== false) env.GELDAR_INTERNAL = '1';
  const r = spawnSync(
    bashExe as string,
    [bashPath(join(world.fleet, 'bootstrap', 'bootstrap.sh'))],
    { env, encoding: 'utf8', timeout: 120_000 },
  );
  return { status: r.status, stderr: r.stderr ?? '' };
}

function calls(world: World): string[] {
  const log = join(world.state, 'calls.log');
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
}

function fstabLines(world: World): string[] {
  const fstab = join(world.root, 'etc', 'fstab');
  return existsSync(fstab)
    ? readFileSync(fstab, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('LABEL='))
    : [];
}

// Every entry under dir with its content (symlinks by target), so two runs compare exactly.
function snapshot(dir: string): string {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const st = lstatSync(p);
      if (st.isDirectory()) {
        out.push(`${relative(dir, p)}/`);
        walk(p);
      } else if (st.isSymbolicLink()) {
        out.push(`${relative(dir, p)}\t-> ${readlinkSync(p)}`);
      } else {
        out.push(`${relative(dir, p)}\t${readFileSync(p, 'utf8')}`);
      }
    }
  };
  walk(dir);
  return out.join('\n');
}

it('bash is present, and a missing shell is a failure in CI', () => {
  if (!ciRequiresShells(process.env.CI)) {
    // Locally a missing shell is skipped visibly, never passed vacuously.
    if (!bashExe) console.warn('SKIPPED: bash is missing, bootstrap tests did not run');
    return;
  }
  expect(bashExe, 'bash is required when CI is set').toBeDefined();
});

// The fakes are extensionless scripts on PATH; Git Bash on win32 does not run them, so the
// suite runs on Linux (and in CI) and skips on win32 with the reason.
const win = process.platform === 'win32';
if (win) console.warn('SKIPPED: fake commands need POSIX exec bits; bootstrap tests did not run');
const describeBash = bashExe && !win ? describe : describe.skip;

describeBash('fleet/bootstrap/bootstrap.sh (F-01b)', () => {
  it('lays out the Contract paths: three fstab lines, players/, the runner, the install', () => {
    const world = makeWorld();
    expect(run(world).status).toBe(0);
    expect(fstabLines(world)).toEqual([
      'LABEL=geldar-nvme-d /srv/geldar/nvme-d auto defaults,nofail 0 2',
      'LABEL=geldar-nvme-e /srv/geldar/nvme-e auto defaults,nofail 0 2',
      'LABEL=geldar-nvme-g /srv/geldar/nvme-g auto defaults,nofail 0 2',
    ]);
    for (const x of ['d', 'e', 'g']) {
      const players = join(world.root, 'srv', 'geldar', `nvme-${x}`, 'players');
      expect(existsSync(players)).toBe(true);
      expect(calls(world)).toContain(`chown geldar ${players}`);
    }
    expect(calls(world)).toContain(
      'useradd --system --home-dir /opt/geldar-runner --shell /usr/sbin/nologin geldar-runner',
    );
    expect(readFileSync(join(world.root, 'etc', 'geldar', 'fleet.conf'), 'utf8')).toBe(
      readFileSync(join(confDir, 'fleet.conf.example'), 'utf8'),
    );
    expect(readFileSync(join(world.root, 'etc', 'tmpfiles.d', 'geldar-fleet.conf'), 'utf8')).toBe(
      'd /run/geldar-fleet 0770 root geldar-runner -\n',
    );
    expect(readlinkSync(join(world.root, 'usr', 'local', 'bin', 'geldar-fleet-place'))).toBe(
      '/usr/local/lib/geldar-fleet/bin/place.sh',
    );
    expect(readlinkSync(join(world.root, 'usr', 'local', 'bin', 'geldar-play'))).toBe(
      `${world.root}${HOME}/scriptorium/launcher/geldar-play`,
    );
    expect(existsSync(join(world.root, HOME.slice(1), 'scriptorium', '.git'))).toBe(true);
    expect(calls(world)).toContain(
      `runuser -u geldar -- git -C ${world.root}${HOME}/scriptorium checkout --quiet --detach kit-v0.1.0-rc21`,
    );
  }, 120_000);

  it('a second run changes nothing: the fstab keeps three lines', () => {
    const world = makeWorld();
    expect(run(world).status).toBe(0);
    const before = snapshot(world.root);
    expect(run(world).status).toBe(0);
    expect(snapshot(world.root)).toBe(before);
    expect(fstabLines(world)).toHaveLength(3);
  }, 120_000);

  it('an existing fleet.conf is kept', () => {
    const world = makeWorld({ fleetConf: 'max_hosts=4\nmin_free_pct=10\n' });
    expect(run(world).status).toBe(0);
    expect(readFileSync(join(world.root, 'etc', 'geldar', 'fleet.conf'), 'utf8')).toBe(
      'max_hosts=4\nmin_free_pct=10\n',
    );
  }, 120_000);

  (process.platform === 'linux' ? it : it.skip)(
    'the Contract modes hold (Linux only: stat modes do not exist on win32)',
    () => {
      const world = makeWorld();
      expect(run(world).status).toBe(0);
      const modes: Record<string, number> = {
        'etc/geldar/tokens': 0o750,
        'etc/geldar/keys': 0o750,
        'etc/geldar/placement': 0o750,
        'etc/geldar/roster': 0o750,
        'etc/geldar/fleet.conf': 0o644,
        'var/log/geldar-hosts.log': 0o660,
      };
      for (const [path, mode] of Object.entries(modes)) {
        expect(statSync(join(world.root, path)).mode & 0o777, path).toBe(mode);
      }
    },
    120_000,
  );

  it('the runner is never added to docker, sudo or wheel', () => {
    const world = makeWorld();
    expect(run(world).status).toBe(0);
    expect(calls(world).some((c) => /^(usermod|gpasswd|adduser) /.test(c))).toBe(false);
    const useradd = calls(world).find((c) => c.startsWith('useradd '));
    expect(useradd).toBeDefined();
    expect(useradd).not.toMatch(/ -G | --groups/);
    expect(readFileSync(join(world.state, 'group'), 'utf8')).toBe(GROUPS);
  }, 120_000);

  it('a runner already in docker fails the self-check with exit 1', () => {
    const world = makeWorld({ groups: 'docker:x:999:geldar-runner\nsudo:x:27:\nwheel:x:10:\n' });
    const r = run(world);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('none of docker, sudo and wheel');
  }, 120_000);

  it('a missing geldar exits 6 before any step acts', () => {
    const world = makeWorld({ noGeldar: true });
    const r = run(world);
    expect(r.status).toBe(6);
    expect(r.stderr).toContain('the VM user geldar does not exist');
    expect(calls(world)).toEqual([]);
    expect(existsSync(join(world.root, 'etc'))).toBe(false);
  }, 120_000);

  it.each(['LAUNCHER_URL', 'LAUNCHER_COMMIT'])(
    '%s set to FILL_ME exits 5 before any step acts',
    (key) => {
      const world = makeWorld({ edits: { [key]: 'FILL_ME' } });
      const r = run(world);
      expect(r.status).toBe(5);
      expect(r.stderr).toContain(`${key} is still FILL_ME`);
      expect(calls(world)).toEqual([]);
      expect(existsSync(join(world.root, 'etc'))).toBe(false);
    },
    120_000,
  );

  it('a clone at the wrong commit exits 6', () => {
    const world = makeWorld({ cloneCommit: `deadbeef${'0'.repeat(32)}` });
    const r = run(world);
    expect(r.status).toBe(6);
    expect(r.stderr).toContain('not 79b28f7');
  }, 120_000);

  it('a geldar-runner git older than 2.47.1 fails the self-check with exit 1', () => {
    const world = makeWorld({ gitVersion: '2.39.5' });
    const r = run(world);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('geldar-runner runs git 2.47.1 or newer');
  }, 120_000);

  it('skips the install and the launcher clone while fleet/bin is absent', () => {
    const world = makeWorld({ noBin: true });
    const r = run(world);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('skipped');
    expect(calls(world).some((c) => c.startsWith('runuser -u geldar -- git clone'))).toBe(false);
    expect(existsSync(join(world.root, 'usr', 'local', 'lib', 'geldar-fleet'))).toBe(false);
  }, 120_000);

  it('refuses to run as non-root', () => {
    const world = makeWorld({ uid: '1000' });
    expect(run(world).status).toBe(2);
    expect(calls(world)).toEqual([]);
    expect(existsSync(join(world.root, 'etc'))).toBe(false);
  }, 120_000);

  it('ignores GEL_ROOT without GELDAR_INTERNAL=1', () => {
    // The fixture: with the seam on, every write lands in the temp tree. With it off the script
    // writes the real paths, so the half that runs them is skipped as root, where /etc would be
    // written. As a non-root user the first write to /etc fails, and nothing moves.
    if (process.getuid?.() === 0) {
      console.warn('SKIPPED: seam-off half writes the real paths; it does not run as root');
      return;
    }
    const world = makeWorld();
    const r = run(world, { seam: false });
    expect(existsSync(join(world.root, 'etc'))).toBe(false);
    expect(r.status).not.toBe(0);
  }, 120_000);
});
