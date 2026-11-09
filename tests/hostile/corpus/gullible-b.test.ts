import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forGroup, makePlayer } from '../../../launcher/test/harness.ts';
import { attack, benign, expectHostUnchanged } from '../../../launcher/test/hostile/world.ts';
import { manifest, runGullible } from './corpus.ts';

const T = 120_000;
const entry = manifest.find((e) => e.id === 'MB-06');
if (!entry) throw new Error('MB-06 missing from the manifest');
const norm = (p: string) => p.replaceAll('\\', '/').toLowerCase();

// Every -v / --volume value in an argv.
const volumes = (argv: string[]): string[] =>
  argv.flatMap((a, i) => {
    if (a === '-v' || a === '--volume') return [argv[i + 1] ?? ''];
    const m = /^(?:-v|--volume)=(.*)$/.exec(a);
    return m ? [m[1] ?? ''] : [];
  });

describe.each(forGroup('hostile'))('gullible session MB-06 ($name)', (launcher) => {
  it('control: a benign session ends saved', { timeout: T }, () => {
    const a = attack(launcher, { session: benign });
    expect(a.finish.status, a.finish.stderr).toBe(0);
    expectHostUnchanged(a.before, a.after, { advancedBranch: true });
  });

  it('copying the sibling player repo leaves no players or host path in any docker argv', {
    timeout: T,
  }, () => {
    const a = runGullible(launcher, entry, {
      setup: (w) => makePlayer(w, { id: 'other' }),
    });
    expect(a.ran).toBe(true);
    const calls = a.world.calls();
    expect(calls.length, 'no docker calls recorded').toBeGreaterThan(0);
    const bad = [a.world.players, a.player.clone, join(a.world.root, 'canary')].map(norm);
    for (const argv of calls) {
      for (const v of volumes(argv)) {
        expect(norm(v), `-v ${v}`).not.toContain('/players');
        for (const b of bad) expect(norm(v), `-v ${v}`).not.toContain(b);
      }
    }
  });
});
