import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forGroup, run } from '../harness.ts';
import { type Attack, attack, benign } from './world.ts';

// SC-60h, H-15 (T-15): the workspace volume and bundle.bundle are removed only after a
// successful push. After each failure both still exist; `resolve --discard` removes them; a
// success removes them and nothing else (the CLI volume survives).
const T = 180_000;
const OK = '{"ok":true,"reasons":[]}';

const vol = (a: Attack, name: string) => join(a.world.dockerRoot, 'vol', name);
const ws = (a: Attack) => vol(a, 'geldar-ws-abc');
const cli = (a: Attack) => vol(a, 'geldar-cli-abc-claude');
const held = (a: Attack) => join(a.player.stateDir, 'held');
const session = (a: Attack) => join(a.player.stateDir, 'session');

const originMoves = `t=$(mktemp -d)
git clone -q "$(git -C "$HOST_CLONE" remote get-url origin)" "$t/o"
git -C "$t/o" commit -q --allow-empty -m elsewhere
git -C "$t/o" push -q origin main
`;

const failures: { name: string; session: string; env?: Record<string, string> }[] = [
  {
    name: 'host_moved',
    session: `${benign}git -C "$HOST_CLONE" commit -q --allow-empty -m host-moved\n`,
  },
  { name: 'push_failed', session: `${originMoves}${benign}` },
  { name: 'ff_failed', session: benign, env: { GELDAR_TEST_FORCE_FF_FAIL: '1' } },
  {
    name: 'recheck_failed',
    session: 'echo x > CLAUDE.md\ngit add CLAUDE.md\ngit commit -q -m m\n',
    env: { FAKE_VERIFY_STDOUT: OK },
  },
];

describe.each(forGroup('hostile'))('H-15 cleanup ($name)', (launcher) => {
  it.each(failures)(
    'after $name the workspace and the bundle are kept, and --discard removes them',
    { timeout: T },
    (f) => {
      const a = attack(launcher, { session: f.session, env: f.env });
      expect(a.finish.status, a.finish.stderr).toBe(3);
      expect(existsSync(ws(a)), 'workspace volume kept').toBe(true);
      expect(existsSync(join(held(a), 'bundle.bundle')), 'held bundle kept').toBe(true);
      expect(existsSync(join(session(a), 'bundle.bundle')), 'session bundle kept').toBe(true);
      expect(existsSync(cli(a)), 'CLI volume kept').toBe(true);
      const env = launcher.name === 'bash' ? a.world.env : a.world.envPwsh;
      const r = run(launcher, ['resolve', 'abc', '--discard'], { env, timeoutMs: T });
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(ws(a)), 'workspace removed by --discard').toBe(false);
      expect(existsSync(held(a)), 'held removed by --discard').toBe(false);
      expect(existsSync(session(a))).toBe(false);
      expect(existsSync(cli(a)), 'CLI volume survives --discard').toBe(true);
      expect(existsSync(join(a.player.stateDir, 'clone'))).toBe(true);
    },
  );

  it('a success removes the workspace and the bundle and nothing else', { timeout: T }, () => {
    const a = attack(launcher, { session: benign });
    expect(a.finish.status, a.finish.stderr).toBe(0);
    expect(existsSync(ws(a)), 'workspace volume removed').toBe(false);
    expect(existsSync(session(a)), 'session dir removed').toBe(false);
    expect(existsSync(join(a.player.stateDir, 'pub')), 'pub dir removed (N4)').toBe(false);
    expect(existsSync(held(a))).toBe(false);
    expect(existsSync(join(a.player.stateDir, 'start'))).toBe(false);
    expect(existsSync(cli(a)), 'CLI volume survives').toBe(true);
    const left = readdirSync(a.player.stateDir);
    expect(left).toContain('clone');
    expect(left).toContain('branch');
    const rm = a.world
      .calls()
      .filter((c) => c[0] === 'volume' && c[1] === 'rm')
      .map((c) => c[2]);
    expect(rm).toEqual(['geldar-ws-abc']);
  });
});
