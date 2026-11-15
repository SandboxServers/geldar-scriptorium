// Shared by bootstrap.test.ts and bootstrap-launcher.test.ts: the fake commands, the temp trees, the
// run wrapper and the shell gates. Each test file registers cleanupWorlds in its own afterEach.
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
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { bashExe, bashPath } from '../../launcher/test/harness.ts';

// The guard of launcher/test/core.test.ts, copied as is: any truthy CI makes a missing shell a failure.
export function ciRequiresShells(ci: string | undefined): boolean {
  return ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false';
}

const here = dirname(fileURLToPath(import.meta.url));
const bootstrapDir = resolve(here, '..', 'bootstrap');
export const confDir = resolve(here, '..', 'conf');
export const HOME = '/home/geldar';
// The commit the fake launcher tag resolves to: it starts with the tag's 79b28f7, as the real one does.
export const PINNED_COMMIT = `79b28f7${'0'.repeat(33)}`;
// A clone whose HEAD is some other commit, for the wrong-commit test.
export const OTHER_COMMIT = `deadbeef${'0'.repeat(32)}`;
export const GROUPS = 'docker:x:999:\nsudo:x:27:\nwheel:x:10:\n';

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
// argv; the clone is faked as a directory, and rev-parse answers from the state files. The state
// files unknown-ref (no launcher commit resolves, so rev-parse and checkout fail) and tag-missing
// (the commit resolves only after a fetch) change those answers.
const FAKE_GIT = [
  'case "$1" in',
  '  --version) echo "git version $(cat "$FAKE_STATE/git-version-$FAKE_RUN_AS")" ;;',
  '  *)',
  '    echo "git $*" >> "$FAKE_STATE/calls.log"',
  '    case "$1" in',
  '      clone) for a in "$@"; do last=$a; done; mkdir -p "$last/.git" ;;',
  '      -C)',
  '        if [ "$3" = rev-parse ] && [ "$4" = HEAD ]; then cat "$FAKE_STATE/clone-commit"; fi',
  '        if [ "$3" = rev-parse ] && [ "$4" != HEAD ]; then',
  '          if [ -e "$FAKE_STATE/unknown-ref" ]; then exit 128; fi',
  '          if [ -e "$FAKE_STATE/tag-missing" ] && [ ! -e "$FAKE_STATE/fetched" ]; then exit 128; fi',
  '          cat "$FAKE_STATE/pinned-commit"',
  '        fi',
  '        if [ "$3" = fetch ]; then touch "$FAKE_STATE/fetched"; fi',
  '        if [ "$3" = checkout ] && [ -e "$FAKE_STATE/unknown-ref" ]; then exit 128; fi ;;',
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
  // Every package is installed, unless the fixture packages-missing exists: then apt-get runs.
  'dpkg-query': [
    'if [ -e "$FAKE_STATE/packages-missing" ]; then echo "deinstalled"; else echo "install ok installed"; fi',
  ].join('\n'),
  // Fails, so a step that installs packages exits through its failure.
  'apt-get': 'echo "apt-get $*" >> "$FAKE_STATE/calls.log"\nexit 100',
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
  noKnownHosts?: boolean; // the deploy key is placed but launcher_known_hosts is not
  existingClone?: boolean; // a launcher clone already in the geldar home of the temp tree
  unknownRef?: boolean; // no launcher commit resolves: the clone's rev-parse and checkout fail
  tagMissing?: boolean; // the launcher commit resolves only after the clone is fetched
  packagesMissing?: boolean; // dpkg-query reports the git packages missing, so apt-get runs
}

interface World {
  dir: string;
  fleet: string;
  root: string;
  state: string;
  fakes: string;
}

const made: string[] = [];

// Removes every temp tree a test made. Each test file runs it after each test.
export function cleanupWorlds(): void {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
}

function writeExe(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

// A temp copy of the fleet tree (the script reads versions.env and conf/ next to itself), a
// GEL_ROOT tree, the fakes and their fixtures. The repo's files are never edited by a test.
export function makeWorld(setup: Setup = {}): World {
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
    if (!setup.noKnownHosts) {
      writeFileSync(join(world.root, 'etc', 'geldar', 'launcher_known_hosts'), 'placeholder\n');
    }
  }
  if (setup.existingClone) {
    mkdirSync(join(world.root, HOME.slice(1), 'scriptorium', '.git'), { recursive: true });
  }
  if (setup.unknownRef) writeFileSync(join(world.state, 'unknown-ref'), '');
  if (setup.tagMissing) writeFileSync(join(world.state, 'tag-missing'), '');
  if (setup.packagesMissing) writeFileSync(join(world.state, 'packages-missing'), '');
  return world;
}

// Runs the copied script. GELDAR_INTERNAL=1 turns the GEL_ROOT seam on unless seam is false. umask
// runs the script from a shell whose umask is that value, so a test can check the script sets its own.
export function run(world: World, opts: { seam?: boolean; umask?: string } = {}) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.toUpperCase() === 'PATH' || k.startsWith('GEL')) continue;
    env[k] = v;
  }
  env.PATH = `${bashPath(world.fakes)}:/usr/bin:/bin`;
  env.FAKE_STATE = bashPath(world.state);
  env.GEL_ROOT = bashPath(world.root);
  if (opts.seam !== false) env.GELDAR_INTERNAL = '1';
  const script = bashPath(join(world.fleet, 'bootstrap', 'bootstrap.sh'));
  const args =
    opts.umask === undefined ? [script] : ['-c', `umask ${opts.umask}; exec bash "$0"`, script];
  const r = spawnSync(bashExe as string, args, { env, encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, stderr: r.stderr ?? '' };
}

export function calls(world: World): string[] {
  const log = join(world.state, 'calls.log');
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
}

export function isClone(call: string): boolean {
  return call.includes(' git clone ');
}

export function fstabLines(world: World): string[] {
  const fstab = join(world.root, 'etc', 'fstab');
  return existsSync(fstab)
    ? readFileSync(fstab, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('LABEL='))
    : [];
}

// Every entry under dir with its content (symlinks by target), so two runs compare exactly.
export function snapshot(dir: string): string {
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

// The fakes are extensionless scripts on PATH; Git Bash on win32 does not run them, so the
// suite runs on Linux (and in CI) and skips on win32 with the reason.
const win = process.platform === 'win32';
if (win) console.warn('SKIPPED: fake commands need POSIX exec bits; bootstrap tests did not run');
export const describeBash = bashExe && !win ? describe : describe.skip;
export const linuxIt = process.platform === 'linux' ? it : it.skip;
