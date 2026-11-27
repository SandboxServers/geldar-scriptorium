// The habits: the means that worked for the adopted goal. When the intent this agent ran for its exact adopted goal
// finished (the plain line, never a failure), its program and arguments are remembered under that goal in state.habits.
// Only the agent's own record: nothing here reads the world beyond that one line, and nothing is shown to the model.
import type { Observation } from '../observe.ts';
import { HABITS_MAX, type InstinctState } from '../state.ts';
import { modeOf } from './idle.ts';

/** The goals kept at most. The least recently used goal is dropped first. */
export const GOALS_MAX = 50;
/** The one plain line the world sends for a finished intent. */
export const FINISHED_LINE = 'Your intent finished.';

/** JSON text with the object keys sorted at every level, so the same arguments always give the same text. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Remembers one finished means for a goal: a repeat counts n up, and the goal moves to the most recent place. */
function remember(
  state: InstinctState,
  goal: string,
  program: string,
  args: Record<string, unknown>,
): void {
  const kept = (Object.hasOwn(state.habits, goal) ? state.habits[goal] : undefined) ?? [];
  const key = stableJson(args);
  const same = kept.find((h) => h.program === program && stableJson(h.arguments) === key);
  if (same !== undefined) same.n += 1;
  else kept.push({ program, arguments: args, n: 1 });
  // The most used first. The sort is stable, so of two equal counts the newer one is the one dropped.
  kept.sort((a, b) => b.n - a.n);
  delete state.habits[goal];
  // defineProperty, not assignment: a goal named __proto__ must become an own key, never a prototype change.
  Object.defineProperty(state.habits, goal, {
    value: kept.slice(0, HABITS_MAX),
    enumerable: true,
    writable: true,
    configurable: true,
  });
  // Key order is insertion order, so the first key is the least recently used goal.
  while (Object.keys(state.habits).length > GOALS_MAX) {
    const first = Object.keys(state.habits)[0];
    if (first === undefined) break;
    delete state.habits[first];
  }
}

/**
 * Learns from one waking, before the decision. When the plain finished line came and the last intent was for the exact
 * adopted goal, that intent's means is remembered. A reworded goal misses, which is safe and weak. Flee and unknown
 * programs are never stored, because modeOf gives them no mode. A failed intent is never remembered.
 */
export function learnHabits(state: InstinctState, obs: Observation, goal: string | null): void {
  const last = state.last_intent;
  if (goal === null || last === null || last.goal !== goal) return;
  const finished = obs.events.some((e) => e.kind === 'intent_finished' && e.text === FINISHED_LINE);
  if (!finished || obs.events.some((e) => e.kind === 'intent_failed')) return;
  if (modeOf(last.program) === null) return;
  remember(state, goal, last.program, last.arguments);
}
