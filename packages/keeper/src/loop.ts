import type { KeeperConfig } from './config.ts';
import type { KeeperDeps } from './keeper.ts';
import { runOnce } from './keeper.ts';
import { checkpointRequestTime, serveSyncRequest, syncRequestTime } from './state.ts';

/** The clock and the sleep, injectable so tests need no real time. */
export interface Clock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export const POLL_MS = 1000;

export type Wake = 'interval' | 'checkpoint' | 'sync';

// Waits for the interval, or for a checkpoint-request or sync-request that is new since the cycle
// began. `since` and `syncSince` are the requests' mtimes when the cycle started (null for none);
// a request counts when it exists and differs from it.
export async function waitForWake(
  cfg: KeeperConfig,
  clock: Clock,
  since: number | null,
  stop: () => boolean,
  syncSince: number | null = null,
): Promise<Wake> {
  const deadline = clock.now() + cfg.intervalSeconds * 1000;
  for (;;) {
    const seen = checkpointRequestTime(cfg.supervisorState);
    if (seen !== null && seen !== since) return 'checkpoint';
    const synced = syncRequestTime(cfg.state);
    if (synced !== null && synced !== syncSince) return 'sync';
    if (clock.now() >= deadline || stop()) return 'interval';
    await clock.sleep(Math.min(POLL_MS, deadline - clock.now()));
  }
}

// Runs until stop() is true. The request times are read before each run, so a request that
// arrives during a run wakes the next wait at once. A sync-request the run served is removed.
export async function runLoop(
  cfg: KeeperConfig,
  deps: KeeperDeps,
  clock: Clock,
  stop: () => boolean,
): Promise<void> {
  while (!stop()) {
    const since = checkpointRequestTime(cfg.supervisorState);
    const syncSince = syncRequestTime(cfg.state);
    await runOnce(cfg, deps);
    serveSyncRequest(cfg.state, syncSince);
    if (stop()) return;
    await waitForWake(cfg, clock, since, stop, syncSince);
  }
}
