import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { runOnce } from './keeper.ts';
import { touchesMemory, unsafePath } from './upstream-gate.ts';
import type { RemoteChange, World } from './world.fixture.ts';
import { makeWorld, plantHook } from './world.fixture.ts';

let world: World | undefined;
afterEach(() => {
  world?.cleanup();
  world = undefined;
});

function fresh(): World {
  world = makeWorld();
  return world;
}

const status = (w: World): Record<string, unknown> =>
  JSON.parse(readFileSync(join(w.cfg.state, 'status.json'), 'utf8'));
const bundleFile = (w: World): string => join(w.cfg.state, 'upstream.bundle');
const manifestFile = (w: World): string => join(w.cfg.state, 'upstream.json');
const held = (w: World): boolean => existsSync(join(w.cfg.state, 'HELD'));
const bundleCalls = (w: World): number => w.calls.filter((c) => c.args.includes('bundle')).length;

// A template change: a new skill file outside memory/.
const template: RemoteChange = (dir) => {
  mkdirSync(join(dir, 'skills'), { recursive: true });
  writeFileSync(join(dir, 'skills', 'new.md'), 'a new skill\n');
};

// The workspace makes one commit and the keeper pushes it, so there is a pushed tip to build on.
async function pushedBase(w: World): Promise<string> {
  w.write('memory/journal/day1.md', 'day one\n');
  const tip = w.commit('journal');
  await runOnce(w.cfg, w.deps);
  return tip;
}

describe('an upstream change on top of the pushed tip', () => {
  test('is offered as a bundle and a manifest, and git fetch applies the bundle', async () => {
    const w = fresh();
    const base = await pushedBase(w);
    const head = w.remoteChange(template);
    const result = await runOnce(w.cfg, w.deps);
    expect(result.outcome).toBe('waiting_for_upstream_sync');
    expect(held(w)).toBe(false);
    expect(JSON.parse(readFileSync(manifestFile(w), 'utf8'))).toEqual({
      head,
      base,
      commits: 1,
      created_utc: '2026-01-02T03:04:05.000Z',
    });
    expect(status(w)).toMatchObject({ upstream_head: head, upstream_result: 'offered' });
    // The bundle carries the branch ref only, so the refspec is named.
    w.git(w.ws, ['fetch', '-q', bundleFile(w), 'refs/heads/main']);
    expect(w.git(w.ws, ['rev-parse', 'FETCH_HEAD'])).toBe(head);
  });

  test('a repeat with the same upstream head builds nothing new', async () => {
    const w = fresh();
    await pushedBase(w);
    w.remoteChange(template);
    await runOnce(w.cfg, w.deps);
    const before = readFileSync(bundleFile(w));
    const calls = bundleCalls(w);
    await runOnce(w.cfg, w.deps);
    expect(bundleCalls(w)).toBe(calls);
    expect(readFileSync(bundleFile(w))).toEqual(before);
    expect(status(w)).toMatchObject({ upstream_result: 'offered' });
  });

  test('with nothing new upstream, the result is none and no offer is left', async () => {
    const w = fresh();
    await pushedBase(w);
    await runOnce(w.cfg, w.deps);
    expect(existsSync(bundleFile(w))).toBe(false);
    expect(existsSync(manifestFile(w))).toBe(false);
    expect(status(w)).toMatchObject({ upstream_head: null, upstream_result: 'none' });
  });

  test('a rewritten remote history is diverged, not held', async () => {
    const w = fresh();
    await pushedBase(w);
    w.remoteChange(template, true);
    const result = await runOnce(w.cfg, w.deps);
    expect(result.outcome).toBe('unchanged');
    expect(held(w)).toBe(false);
    expect(existsSync(bundleFile(w))).toBe(false);
    expect(status(w)).toMatchObject({ upstream_head: null, upstream_result: 'diverged' });
  });

  test('a hook planted in the private clone is not run', async () => {
    const w = fresh();
    await pushedBase(w);
    await runOnce(w.cfg, w.deps);
    plantHook(join(w.cfg.clone, 'hooks'), 'reference-transaction', w.sentinel);
    w.remoteChange(template);
    await runOnce(w.cfg, w.deps);
    expect(status(w)).toMatchObject({ upstream_result: 'offered' });
    expect(existsSync(w.sentinel)).toBe(false);
  });
});

// A workspace that has never pushed: its one local commit touches memory/ and the remote holds
// the start commit, so the merge-base of the two tips is that start commit.
describe('a never-pushed player whose remote is ahead', () => {
  test('is offered the template commit as a bundle, and waits instead of holding', async () => {
    const w = fresh();
    w.write('memory/journal/day1.md', 'day one\n');
    w.commit('journal');
    const base = w.git(w.ws, ['rev-parse', 'HEAD~1']);
    const head = w.remoteChange(template);
    const result = await runOnce(w.cfg, w.deps);
    expect(result.outcome).toBe('waiting_for_upstream_sync');
    expect(held(w)).toBe(false);
    expect(w.pushes()).toBe(0);
    expect(JSON.parse(readFileSync(manifestFile(w), 'utf8'))).toEqual({
      head,
      base,
      commits: 1,
      created_utc: '2026-01-02T03:04:05.000Z',
    });
    expect(status(w)).toMatchObject({
      last_result: 'waiting_for_upstream_sync',
      upstream_head: head,
      upstream_result: 'offered',
    });
  });

  test('is pushed once the workspace is rebased onto the offer, and the offer is cleared', async () => {
    const w = fresh();
    w.write('memory/journal/day1.md', 'day one\n');
    const tip = w.commit('journal');
    const head = w.remoteChange(template);
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('waiting_for_upstream_sync');
    // The supervisor applies the offer and rebases the local commit onto it.
    w.git(w.ws, ['fetch', '-q', bundleFile(w), 'refs/heads/main']);
    w.git(w.ws, ['rebase', '-q', 'FETCH_HEAD']);
    expect(w.git(w.ws, ['rev-parse', 'HEAD^'])).toBe(head);
    expect(w.git(w.ws, ['rev-parse', 'HEAD'])).not.toBe(tip);
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('pushed');
    expect(w.remoteHead()).toBe(w.git(w.ws, ['rev-parse', 'HEAD']));
    expect(w.pushes()).toBe(1);
    expect(existsSync(bundleFile(w))).toBe(false);
    expect(existsSync(manifestFile(w))).toBe(false);
    expect(status(w)).toMatchObject({ upstream_head: null, upstream_result: 'none', held: false });
  });

  test('a remote commit that touches memory/ is held as before, with no offer', async () => {
    const w = fresh();
    w.remoteMoves();
    w.write('memory/journal/two.md', 'two\n');
    w.commit('two');
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('held');
    expect(readFileSync(join(w.cfg.state, 'HELD'), 'utf8')).toMatch(/not_fast_forward/);
    expect(existsSync(bundleFile(w))).toBe(false);
    expect(w.pushes()).toBe(0);
  });

  test('a rewritten remote history with local work is held as before', async () => {
    const w = fresh();
    await pushedBase(w);
    w.write('memory/journal/two.md', 'two\n');
    w.commit('two');
    const rewritten = w.remoteChange(template, true);
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('held');
    expect(readFileSync(join(w.cfg.state, 'HELD'), 'utf8')).toMatch(/not_fast_forward/);
    expect(w.remoteHead()).toBe(rewritten);
    expect(existsSync(bundleFile(w))).toBe(false);
    expect(status(w)).toMatchObject({ upstream_head: null, upstream_result: 'diverged' });
  });
});

describe('an upstream change that fails the check is refused without a bundle', () => {
  const refusals: [string, RemoteChange, string][] = [
    [
      'a symlink',
      (dir, git) => {
        const target = git(['rev-parse', 'HEAD:CLAUDE.md']);
        git(['update-index', '--add', '--cacheinfo', `120000,${target},skills/link`]);
      },
      'symlink',
    ],
    [
      'a submodule',
      (dir, git) => {
        const sha = git(['rev-parse', 'HEAD']);
        git(['update-index', '--add', '--cacheinfo', `160000,${sha},skills/sub`]);
      },
      'submodule',
    ],
    [
      'a memory/ change',
      (dir) => {
        mkdirSync(join(dir, 'memory', 'people'), { recursive: true });
        writeFileSync(join(dir, 'memory', 'people', 'bob.md'), 'bob\n');
      },
      'touches_memory',
    ],
    [
      'a blob over 2 MiB',
      (dir) => {
        mkdirSync(join(dir, 'skills'), { recursive: true });
        writeFileSync(join(dir, 'skills', 'big.md'), 'x'.repeat(3 * 1024 * 1024));
      },
      'blob_too_large',
    ],
    [
      'more than 200 commits',
      (dir, git) => {
        for (let i = 0; i < 201; i++) git(['commit', '-q', '--allow-empty', '-m', `c${i}`]);
      },
      'too_many_commits',
    ],
  ];
  for (const [name, change, code] of refusals) {
    test(`${name} is refused`, async () => {
      const w = fresh();
      await pushedBase(w);
      w.remoteChange(change);
      const result = await runOnce(w.cfg, w.deps);
      expect(result.outcome).toBe('unchanged');
      expect(held(w)).toBe(false);
      expect(existsSync(bundleFile(w))).toBe(false);
      expect(existsSync(manifestFile(w))).toBe(false);
      expect(status(w)).toMatchObject({
        upstream_head: null,
        upstream_result: `refused: ${code}`,
      });
    }, 60_000);
  }
});

describe('the path rule for upstream entries', () => {
  test.each(['../x', 'a/../b', '/abs', 'C:/x', 'a\\b', '.git/config', 'a/.GIT/x', 'a//b'])(
    'refuses %s',
    (path) => expect(unsafePath(path)).toBe(true),
  );
  test.each(['skills/new.md', 'CLAUDE.md', '.claude/settings.json'])('allows %s', (path) =>
    expect(unsafePath(path)).toBe(false),
  );
  test.each(['memory', 'memory/identity.md', 'Memory/x.md'])('memory: %s', (path) =>
    expect(touchesMemory(path)).toBe(true),
  );
  test('a name that only starts with memory is not memory', () => {
    expect(touchesMemory('memories/x.md')).toBe(false);
  });
});
