import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Deps, ExecSpec } from './deps.ts';
import type { Settings } from './settings.ts';
import { readSettings } from './settings.ts';
import { Supervisor } from './supervisor.ts';

/** 2026-01-10 23:00:00 UTC, in epoch seconds. */
export const START = Date.UTC(2026, 0, 10, 23, 0, 0) / 1000;

/** What the fake run does, per run number where a function is given. */
export interface Behaviour {
  secs?: number;
  cost?: number;
  err?: boolean;
  last?: string;
  seen?: boolean;
  rc?: number;
  saveRc?: number;
  /** Writes the STOP file at the end of this run. */
  stopAt?: number;
  /** Creates the keeper's HELD marker at the end of this run. */
  heldAt?: number;
  /** Called while the run is "running" (for the signal test). */
  during?: () => void;
}

/**
 * Calls `fn` with the poll number (1 for the first) at each fake sleep, before the sleep advances the
 * clock: the way a test looks at an idle supervisor, and ends it with a stop request.
 */
export function onPoll(
  f: { deps: Deps },
  fn: (poll: number) => void,
): void {
  const real = f.deps.sleep;
  let polls = 0;
  f.deps.sleep = async (seconds, wake) => {
    polls++;
    fn(polls);
    await real(seconds, wake);
  };
}

/** A supervisor over temporary folders, a fake clock and a fake child process. */
export function makeFixture(
  behaviour: Behaviour = {},
  env: Record<string, string> = {},
  procEnv: Record<string, string> = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'geldar-sup-'));
  const stateDir = join(root, 'state');
  const keeperDir = join(root, 'keeper');
  mkdirSync(keeperDir, { recursive: true });
  const settings: Settings = readSettings({
    GELDAR_SUPERVISOR_STATE: stateDir,
    GELDAR_KEEPER_STATE: keeperDir,
    GELDAR_WORKSPACE: join(root, 'ws'),
    ...env,
  });
  let clock = START;
  const sleeps: number[] = [];
  const specs: ExecSpec[] = [];
  const said: string[] = [];
  const beats: Array<() => void> = [];
  const alive = new Set<number>();
  const deps: Deps = {
    now: () => clock,
    sleep: async (seconds) => {
      sleeps.push(seconds);
      clock += seconds;
      // The guard for a loop that would never end: a stop request (an idle loop ends only on one).
      if (sleeps.length > 60) supervisor.requestStop();
    },
    exec: async (spec) => {
      specs.push(spec);
      if (spec.file !== 'sh') return behaviour.saveRc ?? 0;
      behaviour.during?.();
      const n = Number(/session-(\d+)\.jsonl$/.exec(spec.stdoutPath ?? '')?.[1]);
      const lines = [
        { type: 'assistant', message: { content: [{ type: 'text', text: behaviour.last ?? '' }] } },
      ];
      if (behaviour.seen !== false) {
        lines.push({
          type: 'result',
          total_cost_usd: behaviour.cost ?? 1,
          num_turns: 5,
          is_error: behaviour.err ?? false,
        } as never);
      }
      writeFileSync(spec.stdoutPath ?? '', `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
      clock += behaviour.secs ?? 60;
      if (behaviour.stopAt === n) writeFileSync(join(stateDir, 'STOP'), 'x\n');
      if (behaviour.heldAt === n) writeFileSync(join(keeperDir, 'HELD'), 'rejected\n');
      return behaviour.rc ?? 0;
    },
    every: (_ms, fn) => {
      beats.push(fn);
      return () => undefined;
    },
    alive: (pid) => alive.has(pid),
    say: (line) => said.push(line),
    pid: 4242,
    beforeRun: async () => null,
  };
  const supervisor = new Supervisor(settings, deps, {
    PATH: '/usr/bin',
    HOME: '/root',
    SECRET_OTHER: 'nope',
    ...procEnv,
  });
  const read = (name: string) => readFileSync(join(stateDir, name), 'utf8');
  return {
    root,
    stateDir,
    keeperDir,
    settings,
    deps,
    supervisor,
    sleeps,
    specs,
    said,
    beats,
    alive,
    read,
    has: (name: string) => existsSync(join(stateDir, name)),
    put: (name: string, text: string) => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, name), text);
    },
    runs: () => specs.filter((s) => s.file === 'sh'),
    clock: () => clock,
  };
}
