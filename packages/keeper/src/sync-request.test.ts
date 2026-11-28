import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { waitForWake } from './loop.ts';
import { serveSyncRequest, syncRequestTime } from './state.ts';
import type { World } from './world.fixture.ts';
import { makeWorld } from './world.fixture.ts';

let world: World | undefined;
afterEach(() => {
  world?.cleanup();
  world = undefined;
});

test('a sync-request wakes the wait early, and the run that serves it removes it', async () => {
  world = makeWorld();
  const w = world;
  mkdirSync(w.cfg.state, { recursive: true });
  const request = join(w.cfg.state, 'sync-request');
  let now = 0;
  let written = false;
  const clock = {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
      if (!written) {
        writeFileSync(request, '');
        written = true;
      }
    },
  };
  expect(await waitForWake(w.cfg, clock, null, () => false, null)).toBe('sync');
  expect(now).toBeLessThan(w.cfg.intervalSeconds * 1000);
  serveSyncRequest(w.cfg.state, syncRequestTime(w.cfg.state));
  expect(existsSync(request)).toBe(false);
});
