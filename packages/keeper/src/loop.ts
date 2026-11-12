import type { KeeperConfig } from './config.ts';
import type { KeeperDeps } from './keeper.ts';
import { runOnce } from './keeper.ts';
import { checkpointRequestTime } from './state.ts';

/** The clock and the sleep, injectable so tests need no real time. */
export interface Clock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export const POLL_MS = 1000;

export type Wake = 'interval' | 'checkpoint';

// Waits for the interval, or for a checkpoint-request that is new since the cycle began.
// `since` is the request's mtime when the cycle started (null for none); a request counts when
// it exists and differs from it.
export async function waitForWake(
  cfg: KeeperConfig,
  clock: Clock,
  since: number | null,
  stop: () => boolean,
): Promise<Wake> {
  const deadline = clock.now() + cfg.intervalSeconds * 1000;
  for (;;) {
    const seen = checkpointRequestTime(cfg.supervisorState);
    if (seen !== null && seen !== since) return 'checkpoint';
    if (clock.now() >= deadline || stop()) return 'interval';
    await clock.sleep(Math.min(POLL_MS, deadline - clock.now()));
  }
}

// Runs until stop() is true. The request time is read before each run, so a request that arrives
// during a run wakes the next wait at once.
export async function runLoop(
  cfg: KeeperConfig,
  deps: KeeperDeps,
  clock: Clock,
  stop: () => boolean,
): Promise<void> {
  while (!stop()) {
    const since = checkpointRequestTime(cfg.supervisorState);
    await runOnce(cfg, deps);
    if (stop()) return;
    await waitForWake(cfg, clock, since, stop);
  }
}
