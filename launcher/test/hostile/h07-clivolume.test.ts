import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forGroup, git, makePlayer, makeWorld, run } from '../harness.ts';
import { attack, benign, expectNoDockerCall, expectRefusal } from './world.ts';

// H-07 (T-07): player ids that would escape or collide are refused by the id rule
// (^[a-z][a-z0-9-]{1,38}$, two characters minimum); player.json must name its own folder id; the
// CLI home volume geldar-cli-<id>-claude is mounted only into the session service.

const T = 60_000;
const BAD_IDS = [
  'a/../b',
  '../x',
  'A',
  'Ab',
  'x',
  '-ab',
  '1ab',
  'a_b',
  'a b',
  'a.b',
  'a'.repeat(40),
];

describe.each(forGroup('hostile'))('H-07 CLI volume and ids ($name)', (launcher) => {
  it.each(BAD_IDS)('refuses the id %j before any docker call', { timeout: T }, (id) => {
    const w = makeWorld();
    const env = launcher.name === 'bash' ? w.env : w.envPwsh;
    const r = run(launcher, ['__prepare', id, 'play'], { env, timeoutMs: T });
    expectRefusal(r, 'bad_player_id', { status: 2 });
    expectNoDockerCall(w);
  });

  it('a player.json whose player_id differs from the folder id is bad_player_json', {
    timeout: T,
  }, () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'abc' });
    const gitEnv = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
    const f = join(p.clone, 'player.json');
    writeFileSync(f, readFileSync(f, 'utf8').replace('"player_id": "abc"', '"player_id": "other"'));
    git(p.clone, ['commit', '-am', 'other id'], gitEnv);
    git(p.clone, ['push', 'origin', 'main'], gitEnv);
    const env = launcher.name === 'bash' ? w.env : w.envPwsh;
    const r = run(launcher, ['__prepare', 'abc', 'play'], { env, timeoutMs: T });
    expectRefusal(r, 'bad_player_json', { status: 1 });
    expectNoDockerCall(w);
  });

  it.each([
    ['ab', 'a-'],
    ['a-', 'ab'],
  ])(
    'id %s gets its own CLI volume (not the one of %s), mounted only into the session',
    {
      timeout: 240_000,
    },
    (id, other) => {
      const a = attack(launcher, { id, session: benign });
      expect(a.finish.status, a.finish.stderr).toBe(0);
      const vol = `geldar-cli-${id}-claude`;
      const calls = a.world.calls();
      const create = calls.filter((c) => c[0] === 'volume' && c[1] === 'create');
      expect(
        create.some((c) => c.includes(vol)),
        `no volume create for ${vol}`,
      ).toBe(true);
      expect(create.some((c) => c.includes(`geldar-cli-${other}-claude`))).toBe(false);
      // Every call that names a CLI volume is the create: no bundle, verify or workspace-init call
      // and no other call at all carries it.
      for (const c of calls) {
        if (c.some((x) => x.includes('geldar-cli-'))) {
          expect(c.slice(0, 2), c.join(' ')).toEqual(['volume', 'create']);
        }
      }
      const seen = calls.map((c) => c.find((x) => /^geldar\.role=/.test(x)));
      for (const want of ['bundle', 'verify', 'workspace-init', 'session']) {
        expect(seen, `role ${want} not seen`).toContain(`geldar.role=${want}`);
      }
    },
  );
});
