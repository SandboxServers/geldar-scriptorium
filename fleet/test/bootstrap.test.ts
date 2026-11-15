import { existsSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { bashExe } from '../../launcher/test/harness.ts';
import {
  calls,
  ciRequiresShells,
  cleanupWorlds,
  confDir,
  describeBash,
  fstabLines,
  GROUPS,
  HOME,
  isClone,
  linuxIt,
  makeWorld,
  run,
  snapshot,
} from './bootstrap-helpers.ts';

afterEach(cleanupWorlds);

it('bash is present, and a missing shell is a failure in CI', () => {
  if (!ciRequiresShells(process.env.CI)) {
    // Locally a missing shell is skipped visibly, never passed vacuously.
    if (!bashExe) console.warn('SKIPPED: bash is missing, bootstrap tests did not run');
    return;
  }
  expect(bashExe, 'bash is required when CI is set').toBeDefined();
});

describeBash('fleet/bootstrap/bootstrap.sh (F-01b)', () => {
  it('lays out the Contract paths: three fstab lines, players/, the runner, the install', () => {
    const world = makeWorld();
    expect(run(world).status).toBe(0);
    expect(fstabLines(world)).toEqual([
      'LABEL=nvme-d /srv/geldar/nvme-d auto defaults,nofail 0 2',
      'LABEL=nvme-e /srv/geldar/nvme-e auto defaults,nofail 0 2',
      'LABEL=nvme-g /srv/geldar/nvme-g auto defaults,nofail 0 2',
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

  linuxIt(
    'the script sets umask 022, so a caller with umask 077 still gets the Contract modes (Linux only)',
    () => {
      const world = makeWorld();
      expect(run(world, { umask: '077' }).status).toBe(0);
      const modes: Record<string, number> = {
        'etc/fstab': 0o644,
        'etc/tmpfiles.d/geldar-fleet.conf': 0o644,
        'srv/geldar/nvme-d': 0o755,
        'usr/local/lib/geldar-fleet': 0o755,
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
    const world = makeWorld({ noGeldar: true, noLauncherKey: true });
    const r = run(world);
    expect(r.status).toBe(6);
    expect(r.stderr).toContain('the VM user geldar does not exist');
    expect(calls(world)).toEqual([]);
    expect(existsSync(join(world.root, 'etc'))).toBe(false);
    expect(existsSync(join(world.state, 'root-git-calls'))).toBe(false);
  }, 120_000);

  it('a bootstrap-git.sh failure that no code maps exits 7 (apt-get fails)', () => {
    const world = makeWorld({ packagesMissing: true });
    const r = run(world);
    expect(r.status).toBe(7);
    expect(r.stderr).toContain('bootstrap-git.sh failed with 100');
    expect(calls(world)).toContain('apt-get update -qq');
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
    const world = makeWorld({ uid: '1000', noLauncherKey: true });
    expect(run(world).status).toBe(2);
    expect(calls(world)).toEqual([]);
    expect(existsSync(join(world.root, 'etc'))).toBe(false);
    expect(existsSync(join(world.state, 'root-git-calls'))).toBe(false);
  }, 120_000);

  it('ignores GEL_ROOT without GELDAR_INTERNAL=1', () => {
    // The fixture: with the seam on, every write lands in the temp tree. With it off the script
    // writes the real paths, so the half that runs them is skipped as root, where /etc would be
    // written. As a non-root user the first write to /etc fails, and nothing moves.
    if (process.getuid?.() === 0) {
      console.warn('SKIPPED: seam-off half writes the real paths; it does not run as root');
      return;
    }
    const world = makeWorld({ noLauncherKey: true });
    const r = run(world, { seam: false });
    expect(existsSync(join(world.root, 'etc'))).toBe(false);
    expect(r.status).not.toBe(0);
  }, 120_000);
});
