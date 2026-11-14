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
// The commit the fake launcher tag resolves to: it starts with the tag's 79b28f7, as the real one does.
const PINNED_COMMIT = `79b28f7${'0'.repeat(33)}`;
// A clone whose HEAD is some other commit, for the wrong-commit test.
const OTHER_COMMIT = `deadbeef${'0'.repeat(32)}`;
const GROUPS = 'docker:x:999:\nsudo:x:27:\nwheel:x:10:\n';

// The VM's git at GEL_ROOT/usr/local/bin/git. bootstrap-git.sh asks for its version twice and sees
// the pin both times; every later call (the self-check) reports git-version-vm.
const ROOT_GIT = [
  'n=$(cat "$FAKE_STATE/root-git-calls" 2>/dev/null || echo 0)',
  'n=$((n + 1))',
  'echo "$n" > "$FAKE_STATE/root-git-calls"',
  'if [ "$1" = "--version" ]; then',
  '  if [ "$n" -le 2 ]; then',
  '    echo "git version 2.47.1"',
  '  else',
  '    echo "git version $(cat "$FAKE_STATE/git-version-vm")"',
  '  fi',
  'fi',
].join('\n');

// The git on PATH, which geldar and geldar-runner run through runuser. runuser sets FAKE_RUN_AS to
// the account, so each account reports its own version. Every other call is logged by name and
// argv; the clone is faked as a directory, and rev-parse answers from the state files.
const FAKE_GIT = [
  'case "$1" in',
  '  --version) echo "git version $(cat "$FAKE_STATE/git-version-$FAKE_RUN_AS")" ;;',
  '  *)',
  '    echo "git $*" >> "$FAKE_STATE/calls.log"',
  '    case "$1" in',
  '      clone) for a in "$@"; do last=$a; done; mkdir -p "$last/.git" ;;',
  '      -C)',
  '        if [ "$3" = rev-parse ] && [ "$4" = HEAD ]; then cat "$FAKE_STATE/clone-commit"; fi',
  '        if [ "$3" = rev-parse ] && [ "$4" != HEAD ]; then cat "$FAKE_STATE/pinned-commit"; fi ;;',
  '    esac ;;',
  'esac',
].join('\n');

// A group edit would put geldar-runner in the docker line of the fixture. The fakes do that and log
// the call, so a test that sees the fixture unchanged and no call proves the script never edited.
const groupEdit = (name: string): string =>
  `echo "${name} $*" >> "$FAKE_STATE/calls.log"; sed -i "s/^docker:x:999:.*/docker:x:999:geldar-runner/" "$FAKE_STATE/group"`;

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
  usermod: groupEdit('usermod'),
  gpasswd: groupEdit('gpasswd'),
  adduser: groupEdit('adduser'),
  // A mount that fails when the fixture file mount-fails exists.
  mount: [
    'echo "mount $*" >> "$FAKE_STATE/calls.log"',
    'if [ -e "$FAKE_STATE/mount-fails" ]; then exit 32; fi',
  ].join('\n'),
  // Every mount point is unmounted, so the script always mounts.
  mountpoint: 'exit 1',
  chown: 'echo "chown $*" >> "$FAKE_STATE/calls.log"',
  'systemd-tmpfiles': 'echo "systemd-tmpfiles $*" >> "$FAKE_STATE/calls.log"',
  // runuser -u NAME -- COMMAND...: logs the call, then runs COMMAND as the current user, with
  // FAKE_RUN_AS naming the account so the fake git can answer for it.
  runuser: [
    'echo "runuser $*" >> "$FAKE_STATE/calls.log"',
    'user=$2',
    'shift 3',
    'FAKE_RUN_AS=$user',
    'export FAKE_RUN_AS',
    'exec "$@"',
  ].join('\n'),
  git: FAKE_GIT,
};

interface Setup {
  // The version each git reports: vm is the VM's git, which bootstrap-git.sh checks first and the
  // self-check checks again; geldar and geldar-runner are the accounts' gits. Default 2.47.1.
  gitVersions?: Partial<Record<'vm' | 'geldar' | 'geldar-runner', string>>;
  uid?: string; // what the fake id reports
  edits?: Record<string, string>; // versions.env keys to replace in the temp copy
  noGeldar?: boolean; // the passwd fixture has no geldar account
  noBin?: boolean; // the temp fleet tree has no bin/, so the install and clone are skipped
  fleetAtLib?: boolean; // the temp fleet tree is the installed copy, at GEL_ROOT's lib path
  cloneCommit?: string; // what the fake git reports for the clone's HEAD
  groups?: string; // the group fixture for docker, sudo and wheel
  fleetConf?: string; // an existing fleet.conf in the temp GEL_ROOT tree
  fstab?: string; // an existing fstab in the temp GEL_ROOT tree
  mountFails?: boolean; // every mount fails
  fileWhereDir?: string; // a regular file at this path under GEL_ROOT, where a directory is needed
  noLauncherKey?: boolean; // no launcher deploy key and no known_hosts in the temp tree
  existingClone?: boolean; // a launcher clone already in the geldar home of the temp tree
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
  const root = join(dir, 'root');
  const world: World = {
    dir,
    fleet: setup.fleetAtLib
      ? join(root, 'usr', 'local', 'lib', 'geldar-fleet')
      : join(dir, 'fleet'),
    root,
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
    mkdirSync(join(world.fleet, 'bin'), { recursive: true });
    writeFileSync(join(world.fleet, 'bin', 'place.sh'), '#!/usr/bin/env bash\n');
  }
  for (const [name, body] of Object.entries(FAKE_BODIES)) {
    writeExe(join(world.fakes, name), body);
  }
  writeExe(join(world.root, 'usr', 'local', 'bin', 'git'), ROOT_GIT);
  const versionOf = setup.gitVersions ?? {};
  writeFileSync(join(world.state, 'uid'), setup.uid ?? '0');
  writeFileSync(join(world.state, 'git-version-vm'), versionOf.vm ?? '2.47.1');
  writeFileSync(join(world.state, 'git-version-geldar'), versionOf.geldar ?? '2.47.1');
  writeFileSync(
    join(world.state, 'git-version-geldar-runner'),
    versionOf['geldar-runner'] ?? '2.47.1',
  );
  writeFileSync(join(world.state, 'clone-commit'), setup.cloneCommit ?? PINNED_COMMIT);
  writeFileSync(join(world.state, 'pinned-commit'), PINNED_COMMIT);
  writeFileSync(
    join(world.state, 'passwd'),
    setup.noGeldar ? '' : `geldar:x:1001:1001::${HOME}:/bin/bash\n`,
  );
  writeFileSync(join(world.state, 'group'), setup.groups ?? GROUPS);
  if (setup.mountFails) writeFileSync(join(world.state, 'mount-fails'), '');
  if (setup.fleetConf !== undefined) {
    mkdirSync(join(world.root, 'etc', 'geldar'), { recursive: true });
    writeFileSync(join(world.root, 'etc', 'geldar', 'fleet.conf'), setup.fleetConf);
  }
  if (setup.fstab !== undefined) {
    mkdirSync(join(world.root, 'etc'), { recursive: true });
    writeFileSync(join(world.root, 'etc', 'fstab'), setup.fstab);
  }
  if (setup.fileWhereDir !== undefined) {
    const blocked = join(world.root, setup.fileWhereDir);
    mkdirSync(dirname(blocked), { recursive: true });
    writeFileSync(blocked, 'not a directory\n');
  }
  if (!setup.noLauncherKey) {
    mkdirSync(join(world.root, 'etc', 'geldar', 'keys'), { recursive: true });
    writeFileSync(join(world.root, 'etc', 'geldar', 'keys', 'launcher-read'), 'placeholder\n');
    writeFileSync(join(world.root, 'etc', 'geldar', 'launcher_known_hosts'), 'placeholder\n');
  }
  if (setup.existingClone) {
    mkdirSync(join(world.root, HOME.slice(1), 'scriptorium', '.git'), { recursive: true });
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

function isClone(call: string): boolean {
  return call.includes(' git clone ');
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
const linuxIt = process.platform === 'linux' ? it : it.skip;

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
      const mnt = join(world.root, 'srv', 'geldar', `nvme-${x}`);
      const players = join(mnt, 'players');
      expect(existsSync(players)).toBe(true);
      expect(calls(world)).toContain(`mount ${mnt}`);
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
    expect(calls(world)).toContain(
      `systemd-tmpfiles --create ${join(world.root, 'etc', 'tmpfiles.d', 'geldar-fleet.conf')}`,
    );
    expect(readlinkSync(join(world.root, 'usr', 'local', 'bin', 'geldar-play'))).toBe(
      `${world.root}${HOME}/scriptorium/launcher/geldar-play`,
    );
    expect(existsSync(join(world.root, HOME.slice(1), 'scriptorium', '.git'))).toBe(true);
    expect(calls(world)).toContain(
      `runuser -u geldar -- env HOME=${HOME} GIT_TERMINAL_PROMPT=0 git -C ${world.root}${HOME}/scriptorium checkout --quiet --detach kit-v0.1.0-rc21`,
    );
  }, 120_000);

  it('installs the fleet copy with its six command links and the allow-list', () => {
    const world = makeWorld();
    expect(run(world).status).toBe(0);
    const lib = join(world.root, 'usr', 'local', 'lib', 'geldar-fleet');
    expect(existsSync(join(lib, 'bin', 'place.sh'))).toBe(true);
    for (const verb of ['place', 'add', 'remove', 'restart', 'status', 'dispatch']) {
      const link = join(world.root, 'usr', 'local', 'bin', `geldar-fleet-${verb}`);
      expect(readlinkSync(link), verb).toBe(`/usr/local/lib/geldar-fleet/bin/${verb}.sh`);
    }
    expect(readFileSync(join(world.root, 'etc', 'geldar', 'allowed-repos.txt'), 'utf8')).toBe(
      readFileSync(join(world.fleet, 'conf', 'allowed-repos.txt'), 'utf8'),
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

  it('an fstab without a trailing newline keeps its last line whole', () => {
    const world = makeWorld({ fstab: 'UUID=abc / ext4 defaults 0 1' });
    expect(run(world).status).toBe(0);
    const lines = readFileSync(join(world.root, 'etc', 'fstab'), 'utf8').split('\n');
    expect(lines[0]).toBe('UUID=abc / ext4 defaults 0 1');
    expect(fstabLines(world)).toHaveLength(3);
  }, 120_000);

  it('a fleet tree that is the installed copy is not copied onto itself', () => {
    const world = makeWorld({ fleetAtLib: true });
    const r = run(world);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('copy of fleet/ failed');
    expect(existsSync(join(world.fleet, 'bin', 'place.sh'))).toBe(true);
  }, 120_000);

  it('a mount that fails exits 7 and names the mount point', () => {
    const world = makeWorld({ mountFails: true });
    const r = run(world);
    expect(r.status).toBe(7);
    expect(r.stderr).toContain('mount of /srv/geldar/nvme-d failed');
    expect(calls(world).some((c) => c.startsWith('chown geldar'))).toBe(false);
  }, 120_000);

  it('a step that cannot write exits 7 with its line number', () => {
    // A regular file where /etc/tmpfiles.d must be a directory: the mkdir step fails unmapped.
    const world = makeWorld({ fileWhereDir: 'etc/tmpfiles.d' });
    const r = run(world);
    expect(r.status).toBe(7);
    expect(r.stderr).toContain('step failed at line');
  }, 120_000);

  linuxIt(
    'the Contract modes hold (Linux only: stat modes do not exist on win32)',
    () => {
      const world = makeWorld();
      expect(run(world).status).toBe(0);
      const modes: Record<string, number> = {
        'etc/geldar': 0o755,
        'etc/geldar/tokens': 0o750,
        'etc/geldar/keys': 0o750,
        'etc/geldar/placement': 0o750,
        'etc/geldar/roster': 0o750,
        'etc/geldar/fleet.conf': 0o644,
        'etc/geldar/allowed-repos.txt': 0o644,
        'opt/geldar-runner': 0o755,
        'var/log/geldar-hosts.log': 0o660,
      };
      for (const [path, mode] of Object.entries(modes)) {
        expect(statSync(join(world.root, path)).mode & 0o777, path).toBe(mode);
      }
    },
    120_000,
  );

  it('the chown lines follow the Contract owners', () => {
    const world = makeWorld();
    expect(run(world).status).toBe(0);
    const etc = join(world.root, 'etc', 'geldar');
    for (const line of [
      `chown root:root ${etc}`,
      `chown root:geldar ${etc}/tokens`,
      `chown root:geldar ${etc}/keys`,
      `chown geldar-runner:geldar-runner ${etc}/placement`,
      `chown root:geldar-runner ${etc}/roster`,
      `chown root:root ${etc}/allowed-repos.txt`,
      `chown root:geldar-runner ${join(world.root, 'var', 'log', 'geldar-hosts.log')}`,
      `chown geldar-runner ${join(world.root, 'opt', 'geldar-runner')}`,
    ]) {
      expect(calls(world)).toContain(line);
    }
  }, 120_000);

  it('the runner is never added to docker, sudo or wheel', () => {
    const world = makeWorld();
    expect(run(world).status).toBe(0);
    // The fakes for usermod, gpasswd and adduser would edit the docker line and log the call.
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

  it('the launcher clone uses ssh with the deploy key and the known_hosts file', () => {
    const world = makeWorld();
    expect(run(world).status).toBe(0);
    const clone = calls(world).find(isClone);
    expect(clone).toBeDefined();
    expect(clone).toContain('git@github.com:SandboxServers/geldar-scriptorium.git');
    expect(clone).toContain('GIT_TERMINAL_PROMPT=0');
    expect(clone).toContain(
      `GIT_SSH_COMMAND=ssh -i ${join(world.root, 'etc', 'geldar', 'keys', 'launcher-read')} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${join(world.root, 'etc', 'geldar', 'launcher_known_hosts')}`,
    );
  }, 120_000);

  it('a clone needed with no deploy key exits 5 and clones nothing', () => {
    const world = makeWorld({ noLauncherKey: true });
    const r = run(world);
    expect(r.status).toBe(5);
    expect(r.stderr).toContain('launcher-read');
    expect(calls(world).some(isClone)).toBe(false);
  }, 120_000);

  it('an existing clone skips the clone and the key', () => {
    const world = makeWorld({ existingClone: true, noLauncherKey: true });
    const r = run(world);
    expect(r.status).toBe(0);
    expect(calls(world).some(isClone)).toBe(false);
    expect(calls(world).some((c) => c.includes(' checkout --quiet --detach kit-v0.1.0-rc21'))).toBe(
      true,
    );
  }, 120_000);

  it('a clone at the wrong commit exits 6', () => {
    const world = makeWorld({ cloneCommit: OTHER_COMMIT });
    const r = run(world);
    expect(r.status).toBe(6);
    expect(r.stderr).toContain(`not ${PINNED_COMMIT}`);
  }, 120_000);

  it('the VM git older than 2.47.1 at the self-check fails it with exit 1', () => {
    // bootstrap-git.sh sees the pin; the self-check sees the older VM git.
    const world = makeWorld({ gitVersions: { vm: '2.39.5' } });
    const r = run(world);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("the VM's git is 2.47.1 or newer");
  }, 120_000);

  it('a geldar git older than 2.47.1 fails the self-check with exit 1', () => {
    const world = makeWorld({ gitVersions: { geldar: '2.39.5' } });
    const r = run(world);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('geldar runs git 2.47.1 or newer');
    expect(r.stderr).not.toContain('geldar-runner runs git');
  }, 120_000);

  it('a geldar-runner git older than 2.47.1 fails the self-check with exit 1', () => {
    const world = makeWorld({ gitVersions: { 'geldar-runner': '2.39.5' } });
    const r = run(world);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('geldar-runner runs git 2.47.1 or newer');
    expect(r.stderr).not.toContain('geldar runs git');
  }, 120_000);

  it('skips the install and the launcher clone while fleet/bin is absent', () => {
    const world = makeWorld({ noBin: true });
    const r = run(world);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('skipped');
    expect(calls(world).some(isClone)).toBe(false);
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
