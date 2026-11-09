import { it } from 'vitest';

// Cases that depend on wall-clock bounds, kills of hung processes, sleeps or polling deadlines
// run only in CI (CI is set) or when GELDAR_TIMING_TESTS=1 (dispatch rule 19). The environment
// is read when the case is declared, so a test run can switch it per process.
export function timingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CI) || env.GELDAR_TIMING_TESTS === '1';
}

export function timingIt(name: string, fn: () => void | Promise<void>, timeout?: number) {
  const on = timingEnabled();
  return it.skipIf(!on)(
    on ? name : `${name} [skipped: timing case, set CI or GELDAR_TIMING_TESTS=1]`,
    fn,
    timeout,
  );
}
