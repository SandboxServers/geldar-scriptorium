// The kit-local store: one JSON file in the instinct directory. Read tolerant (missing means empty), written atomically
// (state.json.new, mode 0600, then rename). A corrupt file is renamed state.json.bad once and an empty state is used.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SEEN_MAX = 500;
export const TRIED_MAX = 8;
export const PENDING_MAX = 3;
export const HABITS_MAX = 5;

export interface InstinctState {
  v: 1;
  waking: number;
  picks_in_a_row: number;
  attempts: Record<string, number>;
  tried: Record<string, string[]>;
  seen: string[];
  last_intent: { goal: string; program: string; arguments: Record<string, unknown> } | null;
  habits: Record<string, { program: string; arguments: Record<string, unknown>; n: number }[]>;
  pending_acts: string[];
  cursor: string | null;
}

export function emptyState(): InstinctState {
  return {
    v: 1,
    waking: 0,
    picks_in_a_row: 0,
    attempts: {},
    tried: {},
    seen: [],
    last_intent: null,
    habits: {},
    pending_acts: [],
    cursor: null,
  };
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === 'string');
}

function validState(value: unknown): value is InstinctState {
  if (!isObj(value) || value.v !== 1) return false;
  if (!Number.isSafeInteger(value.waking) || !Number.isSafeInteger(value.picks_in_a_row))
    return false;
  if (!isObj(value.attempts) || !isObj(value.tried) || !isObj(value.habits)) return false;
  if (!isStrings(value.seen) || !isStrings(value.pending_acts)) return false;
  if (value.cursor !== null && typeof value.cursor !== 'string') return false;
  if (value.last_intent !== null && !isObj(value.last_intent)) return false;
  // attempts are integer counts; habits are lists of {program, arguments, n}. Any other shape is corrupt (renamed .bad).
  const attemptsOk = Object.values(value.attempts).every((n) => Number.isSafeInteger(n));
  const habitsOk = Object.values(value.habits).every(
    (list) =>
      Array.isArray(list) &&
      list.every(
        (h) =>
          isObj(h) &&
          typeof h.program === 'string' &&
          isObj(h.arguments) &&
          Number.isSafeInteger(h.n),
      ),
  );
  return attemptsOk && habitsOk && Object.values(value.tried).every(isStrings);
}

/** Bounds the store on the way out, so a long run cannot grow the file without limit. */
function bounded(state: InstinctState): InstinctState {
  const tried: Record<string, string[]> = {};
  for (const [key, hashes] of Object.entries(state.tried)) tried[key] = hashes.slice(-TRIED_MAX);
  const habits: InstinctState['habits'] = {};
  for (const [goal, list] of Object.entries(state.habits)) habits[goal] = list.slice(0, HABITS_MAX);
  return {
    ...state,
    tried,
    habits,
    seen: state.seen.slice(-SEEN_MAX),
    pending_acts: state.pending_acts.slice(0, PENDING_MAX),
  };
}

export function loadState(dir: string): InstinctState {
  const file = join(dir, 'state.json');
  if (!existsSync(file)) return emptyState();
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (validState(value)) return value;
  } catch {
    // fall through: a file that does not parse is corrupt like any other bad file
  }
  renameSync(file, join(dir, 'state.json.bad'));
  return emptyState();
}

export function saveState(dir: string, state: InstinctState): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, 'state.json.new');
  writeFileSync(tmp, `${JSON.stringify(bounded(state))}\n`, { mode: 0o600 });
  renameSync(tmp, join(dir, 'state.json'));
}
