// The habits: the means that worked for the adopted goal. When the intent the instinct step submitted for its exact
// adopted goal finished (the plain line, never a failure), its program and the arguments it sent are remembered under
// that goal in state.habits. The running plan's arguments are not used: the world shows only its status there.
// Only the agent's own record: nothing here reads the world beyond that one line, and nothing is shown to the model.
import type { ActRecord } from '../contract.ts';
import type { Observation } from '../observe.ts';
import { HABITS_MAX, type InstinctState, type Submitted } from '../state.ts';
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
 * The record of an act the instinct step submits: its intent's goal, program and the arguments sent. Null when the act
 * carries no goal, so nothing is recorded for it.
 */
export function submittedFrom(act: ActRecord): Submitted | null {
  const intent: unknown = act.arguments.intent;
  if (typeof intent !== 'object' || intent === null) return null;
  const { goal, program, arguments: args } = intent as Record<string, unknown>;
  if (typeof goal !== 'string' || typeof program !== 'string') return null;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
  return { goal, program, arguments: args as Record<string, unknown> };
}

/**
 * Learns from one waking, before the decision. When the plain finished line came for the last intent, and that intent
 * is the one the instinct step submitted for the exact adopted goal, the submitted arguments are remembered. An intent
 * the agent started itself is never stored, so the model's own intents keep their weak, argument-less record. A
 * reworded goal misses, which is safe and weak. Flee and unknown programs are never stored, because modeOf gives them
 * no mode. A failed intent is never remembered. Any intent that ends clears the submitted record.
 */
export function learnHabits(state: InstinctState, obs: Observation, goal: string | null): void {
  const last = state.last_intent;
  const failed = obs.events.some((e) => e.kind === 'intent_failed');
  const finished = obs.events.some((e) => e.kind === 'intent_finished' && e.text === FINISHED_LINE);
  if (!failed && !finished) return;
  const submitted = state.submitted;
  state.submitted = null;
  if (goal === null || last === null || last.goal !== goal || failed) return;
  if (modeOf(last.program) === null) return;
  if (submitted === null || submitted.goal !== last.goal || submitted.program !== last.program)
    return;
  remember(state, goal, last.program, submitted.arguments);
}
