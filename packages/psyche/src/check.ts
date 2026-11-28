// One d20 check. With rolls on it asks the engine for the dice. With rolls off it answers deterministically at the
// 0.5 line and never touches the rng, so a run with rolls off replays from its inputs alone. check() refuses bad
// inputs before its first draw, with a constant message that names the argument and never carries a sheet value.
import { type Level, modeFor, type Rng, roll, type Score } from '../engine/index.ts';

export interface CheckOptions {
  prof: number;
  rolls: boolean;
}

/** The audit record of one check. Declared here as the card says; HC-18 re-exports the contract's copy. */
export interface RollRecord {
  id: string;
  fx: string;
  score: number;
  dc: number;
  mode: 'dis' | 'flat' | 'adv' | 'off';
  dice: number[];
  kept: number | null;
  bonus: number;
  total: number | null;
  success: boolean;
}

/** The score's own bonus. Mirrors the engine's table; the test compares it with the engine's enumeration. */
const BONUS: Record<Score, number> = { 1: -2, 2: 0, 3: 0, 4: 0, 5: 2 };

function isLevel(value: number): value is Level {
  return Number.isInteger(value) && value >= 0 && value <= 3;
}

function requireLevel(prof: number): Level {
  if (!isLevel(prof)) throw new RangeError(`prof must be an integer from 0 to 3: ${prof}`);
  return prof;
}

function assertScore(score: number): void {
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new RangeError('score must be an integer from 1 to 5');
  }
}

function assertDc(dc: number): void {
  if (!Number.isInteger(dc)) throw new RangeError('dc must be a finite integer');
}

function assertCount(value: number, name: 'n' | 'tick'): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a safe non-negative integer`);
  }
}

function assertLabel(value: string, name: 'fx' | 'lifeKey'): void {
  if (typeof value !== 'string' || value === '' || value.includes(':')) {
    throw new RangeError(`${name} must be a non-empty string without ":"`);
  }
}

/**
 * The chance of success of one check, exact up to floating point. p is the chance that one d20 with the
 * bonus meets the DC; disadvantage needs both dice (p squared), advantage needs one of two (1 - (1 - p) squared).
 * For an integer DC this equals the engine's exactChance. It does not validate score or dc; check() does.
 */
export function successChance(score: Score, dc: number, prof: number): number {
  const bonus = BONUS[score] + prof;
  const p = Math.min(1, Math.max(0, (21 - (dc - bonus)) / 20));
  const { mode } = modeFor(score);
  if (mode === 'dis') return p * p;
  if (mode === 'adv') return 1 - (1 - p) * (1 - p);
  return p;
}

/** The name kit-c and later cards use for successChance. The same function, not a copy. */
export const successProbability = successChance;

/**
 * One check. The id is `${lifeKey}:${tick}:${fx}:${n}`. With rolls on, the engine rolls with rng and the record
 * holds its dice. With rolls off, success is the chance at or above 0.5, the record has mode 'off' and no dice,
 * and bonus is the score bonus plus proficiency. Throws a RangeError, before any draw, for a prof outside 0 to 3,
 * a score that is not an integer 1 to 5, a dc that is not an integer, n or tick that is not a safe non-negative
 * integer, or an fx or lifeKey that is empty or contains ":".
 */
export function check(
  fx: string,
  score: Score,
  dc: number,
  rng: Rng,
  n: number,
  lifeKey: string,
  tick: number,
  opts: CheckOptions,
): { success: boolean; roll: RollRecord } {
  const prof = requireLevel(opts.prof);
  assertScore(score);
  assertDc(dc);
  assertLabel(fx, 'fx');
  assertLabel(lifeKey, 'lifeKey');
  assertCount(n, 'n');
  assertCount(tick, 'tick');
  const id = `${lifeKey}:${tick}:${fx}:${n}`;
  if (!opts.rolls) {
    const success = successChance(score, dc, prof) >= 0.5;
    const record: RollRecord = {
      id,
      fx,
      score,
      dc,
      mode: 'off',
      dice: [],
      kept: null,
      bonus: BONUS[score] + prof,
      total: null,
      success,
    };
    return { success, roll: record };
  }
  const result = roll(fx, score, dc, rng, prof);
  const record: RollRecord = {
    id,
    fx,
    score,
    dc,
    mode: result.mode,
    dice: [...result.dice],
    kept: result.kept,
    bonus: result.bonus,
    total: result.total,
    success: result.success,
  };
  return { success: result.success, roll: record };
}
