import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { runOnce } from './keeper.ts';
import { readLastPushed } from './state.ts';
import type { World } from './world.fixture.ts';
import { KEY_MARKER, makeWorld, plantHook } from './world.fixture.ts';

let world: World | undefined;
afterEach(() => {
  world?.cleanup();
  world = undefined;
});

function fresh(): World {
  world = makeWorld();
  return world;
}

const held = (w: World): string | null =>
  existsSync(join(w.cfg.state, 'HELD'))
    ? readFileSync(join(w.cfg.state, 'HELD'), 'utf8').trim()
    : null;

describe('the clean path', () => {
  test('a good change pushes once and a repeat with no change pushes nothing', async () => {
    const w = fresh();
    w.write('memory/journal/day1.md', 'a good day\n');
    const tip = w.commit('journal');
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('pushed');
    expect(w.remoteHead()).toBe(tip);
    expect(w.pushes()).toBe(1);
    expect(readLastPushed(w.cfg.state)).toBe(tip);
    const status = JSON.parse(readFileSync(join(w.cfg.state, 'status.json'), 'utf8'));
    expect(status).toMatchObject({
      last_result: 'pushed',
      last_pushed_head: tip,
      interval_seconds: 600,
      held: false,
      last_run_utc: '2026-01-02T03:04:05.000Z',
    });
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('unchanged');
    expect(w.pushes()).toBe(1);
  });

  test('a remote ahead with a checked commit waits for the sync and is not held', async () => {
    const w = fresh();
    w.write('memory/journal/day1.md', 'day one\n');
    w.commit('journal');
    w.remoteChange((dir) => {
      mkdirSync(join(dir, 'skills'), { recursive: true });
      writeFileSync(join(dir, 'skills', 'new.md'), 'a new skill\n');
    });
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('waiting_for_upstream_sync');
    expect(held(w)).toBeNull();
    expect(w.pushes()).toBe(0);
    expect(JSON.parse(readFileSync(join(w.cfg.state, 'status.json'), 'utf8'))).toMatchObject({
      last_result: 'waiting_for_upstream_sync',
      upstream_result: 'offered',
      held: false,
    });
  });

  test('a run with nothing new on the first start pushes nothing', async () => {
    const w = fresh();
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('unchanged');
    expect(w.pushes()).toBe(0);
  });
});

describe('refusals end in HELD and nothing is pushed', () => {
  const cases: [string, (w: World) => unknown, RegExp][] = [
    [
      'a path outside memory',
      (w) => w.write('notes.txt', 'not memory\n'),
      /^gate: .*path_not_allowed/,
    ],
    [
      'a symlink entry',
      (w) => {
        w.stage('120000', 'memory/link');
        return true;
      },
      /^gate: .*symlink_not_allowed/,
    ],
    [
      'a submodule entry',
      (w) => {
        w.stage('160000', 'memory/sub');
        return true;
      },
      /^gate: .*gitlink_not_allowed/,
    ],
    [
      'a huge blob',
      (w) => w.write('memory/journal/big.md', 'x'.repeat(3 * 1024 * 1024)),
      /^gate: .*bundle_too_large/,
    ],
  ];
  for (const [name, change, pattern] of cases) {
    test(name, async () => {
      const w = fresh();
      const before = w.remoteHead();
      const committed = change(w) === true;
      if (!committed) w.commit('bad');
      const result = await runOnce(w.cfg, w.deps);
      expect(result.outcome).toBe('held');
      expect(held(w)).toMatch(pattern);
      expect(w.remoteHead()).toBe(before);
      expect(w.pushes()).toBe(0);
    });
  }

  test('a history rewrite is a non-fast-forward', async () => {
    const w = fresh();
    w.write('memory/journal/one.md', 'one\n');
    w.commit('one');
    await runOnce(w.cfg, w.deps);
    const pushed = w.remoteHead();
    w.git(w.ws, ['reset', '-q', '--hard', 'HEAD~1']);
    w.write('memory/journal/other.md', 'other\n');
    w.commit('rewritten');
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('held');
    expect(held(w)).toMatch(/not_fast_forward/);
    expect(w.remoteHead()).toBe(pushed);
    expect(w.pushes()).toBe(1);
  });

  test('a remote that moved ahead', async () => {
    const w = fresh();
    const moved = w.remoteMoves();
    w.write('memory/journal/two.md', 'two\n');
    w.commit('two');
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('held');
    expect(held(w)).toMatch(/not_fast_forward/);
    expect(w.remoteHead()).toBe(moved);
    expect(w.pushes()).toBe(0);
  });

  test('a remote that rejects the push', async () => {
    const w = fresh();
    const before = w.remoteHead();
    mkdirSync(join(w.remote, 'hooks'), { recursive: true });
    writeFileSync(join(w.remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    w.write('memory/journal/three.md', 'three\n');
    w.commit('three');
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('held');
    expect(held(w)).toBe('push_rejected');
    expect(w.remoteHead()).toBe(before);
  });

  test('HELD stops all work until it is removed', async () => {
    const w = fresh();
    w.write('notes.txt', 'bad\n');
    w.commit('bad');
    await runOnce(w.cfg, w.deps);
    expect(held(w)).not.toBeNull();
    // Even a good history is not looked at while HELD stands.
    w.git(w.ws, ['reset', '-q', '--hard', 'HEAD~1']);
    w.write('memory/journal/good.md', 'good\n');
    const tip = w.commit('good');
    const callsBefore = w.calls.length;
    const result = await runOnce(w.cfg, w.deps);
    expect(result).toEqual({ outcome: 'held', reason: 'already_held' });
    expect(w.calls.length).toBe(callsBefore);
    expect(w.pushes()).toBe(0);
    rmSync(join(w.cfg.state, 'HELD'));
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('pushed');
    expect(w.remoteHead()).toBe(tip);
  });
});

describe('a failed remote fetch is retried before it holds', () => {
  // The remote is unreachable while its folder is moved away; it is back once moved back.
  const away = (w: World) => renameSync(w.remote, `${w.remote}.away`);
  const back = (w: World) => renameSync(`${w.remote}.away`, w.remote);
  const status = (w: World) => JSON.parse(readFileSync(join(w.cfg.state, 'status.json'), 'utf8'));

  test('one failed fetch does not hold; the cycle ends as remote_unreachable', async () => {
    const w = fresh();
    w.write('memory/journal/four.md', 'four\n');
    w.commit('four');
    away(w);
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('remote_unreachable');
    expect(held(w)).toBeNull();
    expect(status(w)).toMatchObject({
      last_result: 'remote_unreachable',
      remote_failures: 1,
      held: false,
    });
  });

  test('a fetch that works again resets the count and pushes', async () => {
    const w = fresh();
    w.write('memory/journal/five.md', 'five\n');
    const tip = w.commit('five');
    away(w);
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('remote_unreachable');
    back(w);
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('pushed');
    expect(w.remoteHead()).toBe(tip);
    expect(status(w)).toMatchObject({ last_result: 'pushed', remote_failures: 0, held: false });
  });

  test('fetchFailLimit failures in a row hold, and a held keeper makes no git calls', async () => {
    const w = fresh();
    w.cfg.fetchFailLimit = 3;
    away(w);
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('remote_unreachable');
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('remote_unreachable');
    expect(held(w)).toBeNull();
    expect(await runOnce(w.cfg, w.deps)).toEqual({
      outcome: 'held',
      reason: 'remote_fetch_failed',
    });
    expect(held(w)).toBe('remote_fetch_failed');
    expect(status(w)).toMatchObject({ held: true, last_result: 'held: remote_fetch_failed' });
    const callsBefore = w.calls.length;
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('held');
    expect(w.calls.length).toBe(callsBefore);
  });

  test('the failure count survives a restart', async () => {
    const w = fresh();
    away(w);
    await runOnce(w.cfg, w.deps);
    expect(readFileSync(join(w.cfg.state, 'remote-failures'), 'utf8')).toBe('1\n');
    // Only the state folder carries the count, so a limit of 2 holds on the second failure.
    w.cfg.fetchFailLimit = 2;
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('held');
    expect(held(w)).toBe('remote_fetch_failed');
  });

  test('an unrelated failure still holds at once', async () => {
    const w = fresh();
    w.write('notes.txt', 'not memory\n');
    w.commit('bad');
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('held');
    expect(held(w)).toMatch(/^gate: .*path_not_allowed/);
    expect(status(w)).toMatchObject({ remote_failures: 0 });
  });
});

describe('nothing from the workspace is ever executed', () => {
  const HOOKS = [
    'pre-push',
    'post-checkout',
    'post-merge',
    'pre-commit',
    'post-fetch',
    'reference-transaction',
    'post-update',
    'pre-receive',
    'post-receive',
  ];

  test('hostile hooks and a hostile .git/config have no effect', async () => {
    const w = fresh();
    w.write('memory/journal/five.md', 'five\n');
    const tip = w.commit('five');
    const evil = w.sentinel.replaceAll('\\', '/');
    for (const hook of HOOKS) plantHook(join(w.ws, '.git', 'hooks'), hook, w.sentinel);
    plantHook(join(w.root, 'ws-hooks'), 'pre-push', w.sentinel);
    appendFileSync(
      join(w.ws, '.git', 'config'),
      [
        '[core]',
        `\tfsmonitor = echo fsmonitor >> '${evil}'`,
        `\tsshCommand = echo ssh >> '${evil}'`,
        `\thooksPath = ${join(w.root, 'ws-hooks').replaceAll('\\', '/')}`,
        '[includeIf "gitdir:**"]',
        `\tpath = ${join(w.root, 'evil.inc').replaceAll('\\', '/')}`,
        `[url "${join(w.root, 'nowhere').replaceAll('\\', '/')}"]`,
        `\tinsteadOf = ${w.remote.replaceAll('\\', '/')}`,
        '[credential]',
        `\thelper = !echo cred >> '${evil}'`,
        '[alias]',
        `\tfetch = !echo alias >> '${evil}'`,
        '[uploadpack]',
        `\tpackObjectsHook = ${join(w.root, 'hook.sh').replaceAll('\\', '/')}`,
        '',
      ].join('\n'),
    );
    const result = await runOnce(w.cfg, w.deps);
    expect(existsSync(w.sentinel)).toBe(false);
    expect(result.outcome).toBe('pushed');
    expect(w.remoteHead()).toBe(tip);
  });

  test('a symlinked .git runs nothing', async (ctx) => {
    const w = fresh();
    w.write('memory/journal/six.md', 'six\n');
    w.commit('six');
    for (const hook of HOOKS) plantHook(join(w.ws, '.git', 'hooks'), hook, w.sentinel);
    try {
      renameSync(join(w.ws, '.git'), join(w.root, 'real-git'));
      symlinkSync(join(w.root, 'real-git'), join(w.ws, '.git'), 'dir');
    } catch {
      ctx.skip();
      return;
    }
    const result = await runOnce(w.cfg, w.deps);
    expect(existsSync(w.sentinel)).toBe(false);
    expect(['pushed', 'held']).toContain(result.outcome);
  });

  test('hooks planted in the keeper clone are not run (the hooksPath override)', async () => {
    const w = fresh();
    await runOnce(w.cfg, w.deps);
    for (const hook of HOOKS) plantHook(join(w.cfg.clone, 'hooks'), hook, w.sentinel);
    w.write('memory/journal/seven.md', 'seven\n');
    const tip = w.commit('seven');
    expect((await runOnce(w.cfg, w.deps)).outcome).toBe('pushed');
    expect(w.remoteHead()).toBe(tip);
    expect(existsSync(w.sentinel)).toBe(false);
  });
});

describe('secrets and flags', () => {
  test('the deploy key content never appears in a call, an environment or a log', async () => {
    const w = fresh();
    w.write('memory/journal/eight.md', 'eight\n');
    w.commit('eight');
    await runOnce(w.cfg, w.deps);
    const seen = JSON.stringify([w.calls, w.logs, held(w)]);
    expect(seen).not.toContain(KEY_MARKER);
    expect(w.calls.length).toBeGreaterThan(0);
  });

  test('every git call carries the hardened settings', async () => {
    const w = fresh();
    w.write('memory/journal/nine.md', 'nine\n');
    w.commit('nine');
    await runOnce(w.cfg, w.deps);
    for (const call of w.calls) {
      expect(call.args).toContain(`core.hooksPath=${w.cfg.hooksDir}`);
      expect(call.args).toContain('core.fsmonitor=false');
      expect(call.env.GIT_CONFIG_NOSYSTEM).toBe('1');
      expect(call.env.GIT_TERMINAL_PROMPT).toBe('0');
      expect(call.env.GIT_ASKPASS).toBeUndefined();
    }
    const allowed = w.calls.filter((call) => call.args.includes('protocol.file.allow=user'));
    expect(allowed.length).toBe(
      w.calls.filter((call) => call.args.includes('fetch') && call.args.includes(w.ws)).length,
    );
    expect(w.calls.some((call) => call.args.includes('--recurse-submodules'))).toBe(false);
  });
});
