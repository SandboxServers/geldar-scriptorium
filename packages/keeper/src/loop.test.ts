import { rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { runLoop, waitForWake } from './loop.ts';
import type { World } from './world.fixture.ts';
import { makeWorld } from './world.fixture.ts';

let world: World | undefined;
afterEach(() => {
  world?.cleanup();
  world = undefined;
});

// A clock that only moves when something sleeps; `onSleep` can act at a chosen virtual time.
function fakeClock(onSleep: (now: number) => void = () => {}) {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
      onSleep(now);
    },
  };
}

test('with no request the wait lasts the whole interval', async () => {
  world = makeWorld();
  const clock = fakeClock();
  expect(await waitForWake(world.cfg, clock, null, () => false)).toBe('interval');
  expect(clock.now()).toBe(600_000);
});

test('a checkpoint-request that appears wakes the wait early; its content is never read', async () => {
  world = makeWorld();
  const request = join(world.cfg.supervisorState, 'checkpoint-request');
  const clock = fakeClock((now) => {
    if (now === 30_000) writeFileSync(request, '\u0000not even text');
  });
  expect(await waitForWake(world.cfg, clock, null, () => false)).toBe('checkpoint');
  expect(clock.now()).toBe(30_000);
});

test('a request that was already there at the start of the cycle does not wake it', async () => {
  world = makeWorld();
  const request = join(world.cfg.supervisorState, 'checkpoint-request');
  writeFileSync(request, 'x');
  utimesSync(request, 1000, 1000);
  const clock = fakeClock();
  expect(await waitForWake(world.cfg, clock, 1_000_000, () => false)).toBe('interval');
});

test('the loop runs again at once when a request arrives during the wait', async () => {
  const w = makeWorld();
  world = w;
  const request = join(w.cfg.supervisorState, 'checkpoint-request');
  const clock = fakeClock((now) => {
    if (now === 5000) writeFileSync(request, '');
  });
  const runs = () => w.logs.filter((line) => line.startsWith('keeper:')).length;
  await runLoop(w.cfg, w.deps, clock, () => runs() >= 2);
  expect(runs()).toBe(2);
  expect(clock.now()).toBe(5000);
  rmSync(request);
});

test('after a failed remote fetch the next wait is the short retry interval', async () => {
  const w = makeWorld();
  world = w;
  rmSync(w.remote, { recursive: true, force: true });
  const clock = fakeClock();
  const runs = () => w.logs.filter((line) => line.startsWith('keeper:')).length;
  await runLoop(w.cfg, w.deps, clock, () => runs() >= 2);
  expect(runs()).toBe(2);
  expect(clock.now()).toBe(60_000);
});
