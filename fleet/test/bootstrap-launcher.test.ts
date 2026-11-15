import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { bashExe } from '../../launcher/test/harness.ts';
import {
  calls,
  ciRequiresShells,
  cleanupWorlds,
  describeBash,
  isClone,
  makeWorld,
  OTHER_COMMIT,
  PINNED_COMMIT,
  run,
} from './bootstrap-helpers.ts';

afterEach(cleanupWorlds);

// The same CI guard as bootstrap.test.ts: a missing shell fails the run in CI instead of skipping.
if (!bashExe && ciRequiresShells(process.env.CI))
  throw new Error('bash is required when CI is set');

describeBash('fleet/bootstrap/bootstrap.sh (F-01b)', () => {
  it.each(['LAUNCHER_URL', 'LAUNCHER_COMMIT'])(
    '%s set to FILL_ME exits 5 before any step acts',
    (key) => {
      const world = makeWorld({ edits: { [key]: 'FILL_ME' }, noLauncherKey: true });
      const r = run(world);
      expect(r.status).toBe(5);
      expect(r.stderr).toContain(`${key} is still FILL_ME`);
      expect(calls(world)).toEqual([]);
      expect(existsSync(join(world.root, 'etc'))).toBe(false);
      expect(existsSync(join(world.state, 'root-git-calls'))).toBe(false);
    },
    120_000,
  );

  it.each([
    ['LAUNCHER_COMMIT', 'kit-v0.1.0 rc21'],
    ['LAUNCHER_COMMIT', '--detach'],
    ['LAUNCHER_URL', '-oProxyCommand=evil'],
  ])(
    '%s=%s (whitespace or a leading dash) exits 5 before any step acts',
    (key, value) => {
      const world = makeWorld({ edits: { [key]: value }, noLauncherKey: true });
      const r = run(world);
      expect(r.status).toBe(5);
      expect(r.stderr).toContain(`${key} starts with - or has whitespace`);
      expect(calls(world)).toEqual([]);
      expect(existsSync(join(world.root, 'etc'))).toBe(false);
      expect(existsSync(join(world.state, 'root-git-calls'))).toBe(false);
    },
    120_000,
  );

  it('the launcher clone uses ssh with the deploy key, the known_hosts file and no config', () => {
    const world = makeWorld();
    expect(run(world).status).toBe(0);
    const clone = calls(world).find(isClone);
    expect(clone).toBeDefined();
    expect(clone).toContain(
      ' git clone --quiet -- git@github.com:SandboxServers/geldar-scriptorium.git ',
    );
    expect(clone).toContain('GIT_TERMINAL_PROMPT=0');
    expect(clone).toContain(
      `GIT_SSH_COMMAND=ssh -i ${join(world.root, 'etc', 'geldar', 'keys', 'launcher-read')} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${join(world.root, 'etc', 'geldar', 'launcher_known_hosts')} -F /dev/null`,
    );
  }, 120_000);

  it('a clone needed with no deploy key exits 5 and clones nothing', () => {
    const world = makeWorld({ noLauncherKey: true });
    const r = run(world);
    expect(r.status).toBe(5);
    expect(r.stderr).toContain('launcher-read');
    expect(calls(world).some(isClone)).toBe(false);
    expect(existsSync(join(world.state, 'root-git-calls'))).toBe(false);
  }, 120_000);

  it('a clone needed with the deploy key but no known_hosts exits 5 before bootstrap-git.sh', () => {
    const world = makeWorld({ noKnownHosts: true });
    const r = run(world);
    expect(r.status).toBe(5);
    expect(r.stderr).toContain('launcher_known_hosts');
    expect(calls(world)).toEqual([]);
    expect(existsSync(join(world.state, 'root-git-calls'))).toBe(false);
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

  it('an existing clone that lacks the tag is fetched, then the checkout runs', () => {
    const world = makeWorld({ existingClone: true, tagMissing: true });
    const r = run(world);
    expect(r.status).toBe(0);
    const fetchAt = calls(world).findIndex((c) => c.includes(' fetch --tags --quiet'));
    const checkoutAt = calls(world).findIndex((c) => c.includes(' checkout --quiet --detach'));
    expect(fetchAt).toBeGreaterThan(-1);
    expect(checkoutAt).toBeGreaterThan(fetchAt);
    expect(calls(world)[fetchAt]).toContain('GIT_SSH_COMMAND=ssh -i');
  }, 120_000);

  it('an existing clone that lacks the tag and has no deploy key exits 5 without a fetch', () => {
    const world = makeWorld({ existingClone: true, tagMissing: true, noLauncherKey: true });
    const r = run(world);
    expect(r.status).toBe(5);
    expect(r.stderr).toContain('launcher-read');
    expect(calls(world).some((c) => c.includes(' fetch '))).toBe(false);
  }, 120_000);

  it('a fresh clone that lacks the commit exits 6 with no fetch and no checkout', () => {
    const world = makeWorld({ unknownRef: true });
    const r = run(world);
    expect(r.status).toBe(6);
    expect(r.stderr).toContain('has no commit for kit-v0.1.0-rc21');
    expect(calls(world).some((c) => c.includes(' fetch '))).toBe(false);
    expect(calls(world).some((c) => c.includes(' checkout '))).toBe(false);
  }, 120_000);

  it('an existing clone that still lacks the commit after the fetch exits 6', () => {
    const world = makeWorld({ existingClone: true, unknownRef: true });
    const r = run(world);
    expect(r.status).toBe(6);
    expect(r.stderr).toContain('has no commit for kit-v0.1.0-rc21');
    expect(calls(world).some((c) => c.includes(' fetch --tags --quiet'))).toBe(true);
    expect(calls(world).some((c) => c.includes(' checkout '))).toBe(false);
  }, 120_000);

  it('a clone at the wrong commit exits 6', () => {
    const world = makeWorld({ cloneCommit: OTHER_COMMIT });
    const r = run(world);
    expect(r.status).toBe(6);
    expect(r.stderr).toContain(`not ${PINNED_COMMIT}`);
  }, 120_000);
});
