import type { Supervisor } from './supervisor.ts';

/** The process that delivers the stop signals (a seam for tests). */
export interface SignalSource {
  on(signal: 'SIGINT' | 'SIGTERM' | 'SIGHUP', listener: () => void): unknown;
}

/** SIGINT, SIGTERM and SIGHUP ask for a stop after the current run; they never kill one. */
export function installSignals(source: SignalSource, supervisor: Supervisor): void {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    source.on(signal, () => supervisor.requestStop());
  }
}
