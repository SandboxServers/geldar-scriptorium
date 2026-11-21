// A choice as a tree of d20 checks, and its exact outcome distribution (HC-28a). Each chance node asks for one check;
// the distribution walks both arms, weighted by the chance of success. Pure: no engine draw, no sheet, no clock.
import type { Level, Score } from '@geldar/scriptorium-psyche';

export interface Chance {
  score: Score;
  dc: number;
  proficiency: Level;
}

export type Branch<T> =
  | { kind: 'outcome'; outcome: T }
  | { kind: 'chance'; chance: Chance; success: Branch<T>; failure: Branch<T> };

// Outcomes are keyed by identity, so they must be primitives or shared constants.
export type Dist<T> = Map<T, number>;

/** The chance of success of one check. Production: successProbability from the psyche package. */
export type Prob = (c: Chance) => number;

/** The exact distribution over outcomes. Arms with zero weight are never walked. */
export function distribution<T>(b: Branch<T>, p: Prob): Dist<T> {
  const out: Dist<T> = new Map();
  walk(b, p, 1, out);
  return out;
}

function walk<T>(b: Branch<T>, p: Prob, weight: number, out: Dist<T>): void {
  if (weight === 0) return;
  if (b.kind === 'outcome') {
    out.set(b.outcome, (out.get(b.outcome) ?? 0) + weight);
    return;
  }
  const q = p(b.chance);
  if (!(q >= 0 && q <= 1)) throw new RangeError('probability must be a number from 0 to 1');
  walk(b.success, p, weight * q, out);
  walk(b.failure, p, weight * (1 - q), out);
}
