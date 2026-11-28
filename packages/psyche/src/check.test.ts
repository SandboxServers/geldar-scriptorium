// successChance against the engine's enumeration and the brief 4.1 table, check() with rolls off and on, and the
// names the package entry exposes.
import { describe, expect, it } from 'vitest';
import * as engine from '../engine/index.ts';
import {
  type DrawKey,
  exactChance,
  type Level,
  type Rng,
  rngFor,
  roll,
  type Score,
} from '../engine/index.ts';
import { type CheckOptions, check, successChance, successProbability } from './check.ts';
import * as entry from './index.ts';

const SCORES: readonly Score[] = [1, 2, 3, 4, 5];
const LEVELS: readonly Level[] = [0, 1, 2, 3];

/** Brief 4.1: the chance in whole percent, per score (rows) and DC 8, 11, 14, 17 (columns), proficiency 0. */
const TABLE: Record<Score, readonly number[]> = {
  1: [30, 16, 6, 1],
  2: [42, 25, 12, 4],
  3: [65, 50, 35, 20],
  4: [88, 75, 58, 36],
  5: [94, 84, 70, 51],
};
const TABLE_DCS = [8, 11, 14, 17] as const;

/** A scripted rng: next() returns the given values in order. The engine maps value v to face floor(v * 20) + 1. */
function scripted(values: readonly number[]): Rng {
  let index = 0;
  return {
    next(): number {
      const value = values[index];
      index += 1;
      if (value === undefined) throw new Error('scripted rng ran out of values');
      return value;
    },
    get draws(): number {
      return index;
    },
  };
}

/** The value that makes the engine's d20 show face k: (k - 0.5) / 20. */
function face(k: number): number {
  return (k - 0.5) / 20;
}

const KEY: DrawKey = {
  lifeId: 'life-a',
  producer: 'kit',
  generation: 0,
  tick: 5,
  fx: 'failure',
  decisionSeq: 0,
};

describe('successChance', () => {
  it('matches the brief 4.1 table within one percent for all 20 cells', () => {
    for (const score of SCORES) {
      TABLE_DCS.forEach((dc, column) => {
        const percent = successChance(score, dc, 0) * 100;
        const expected = TABLE[score][column] ?? Number.NaN;
        expect(Math.abs(percent - expected), `score ${score} dc ${dc}`).toBeLessThanOrEqual(1);
      });
    }
  });

  it('equals the engine enumeration for every score, DC 1 to 30 and proficiency 0 to 3', () => {
    for (const score of SCORES) {
      for (const prof of LEVELS) {
        for (let dc = 1; dc <= 30; dc += 1) {
          const { wins, total } = exactChance(score, dc, prof);
          const formula = successChance(score, dc, prof);
          expect(
            Math.abs(formula - wins / total),
            `s${score} dc${dc} p${prof}`,
          ).toBeLessThanOrEqual(1e-9);
        }
      }
    }
  });
});

describe('check', () => {
  it('rolls off is deterministic at the 0.5 line', () => {
    const rng = scripted([]);
    const onLine = check('failure', 3, 11, rng, 0, 'life-a', 5, { prof: 0, rolls: false });
    expect(onLine.success).toBe(true);
    const below = check('failure', 3, 14, rng, 1, 'life-a', 5, { prof: 0, rolls: false });
    expect(below.success).toBe(false);
    expect(onLine.roll).toEqual({
      id: 'life-a:5:failure:0',
      fx: 'failure',
      score: 3,
      dc: 11,
      mode: 'off',
      dice: [],
      kept: null,
      bonus: 0,
      total: null,
      success: true,
    });
  });

  it('rolls off records the score bonus plus proficiency', () => {
    const rng = scripted([]);
    const guard = check('guard', 5, 17, rng, 2, 'life-a', 3, { prof: 2, rolls: false });
    expect(guard.roll.bonus).toBe(4);
    expect(guard.success).toBe(true);
    const idle = check('idle', 1, 8, rng, 3, 'life-a', 3, { prof: 1, rolls: false });
    expect(idle.roll.bonus).toBe(-1);
    expect(idle.success).toBe(false);
    expect(rng.draws).toBe(0);
  });

  it('rolls off never calls the rng', () => {
    const throwing: Rng = {
      next(): number {
        throw new Error('rng must not be called when rolls are off');
      },
      get draws(): number {
        throw new Error('rng must not be read when rolls are off');
      },
    };
    for (const score of SCORES) {
      expect(() =>
        check('idle', score, 11, throwing, 0, 'life-a', 1, { prof: 2, rolls: false }),
      ).not.toThrow();
    }
  });

  it('rolls on records the dice from the engine', () => {
    const rng = scripted([face(2), face(15)]);
    const result = check('guard', 5, 11, rng, 3, 'life-a', 9, { prof: 0, rolls: true });
    expect(result.success).toBe(true);
    expect(result.roll).toEqual({
      id: 'life-a:9:guard:3',
      fx: 'guard',
      score: 5,
      dc: 11,
      mode: 'adv',
      dice: [2, 15],
      kept: 15,
      bonus: 2,
      total: 17,
      success: true,
    });
  });

  it('rolls on with the engine key matches a direct engine roll for every score', () => {
    for (const score of SCORES) {
      for (const prof of LEVELS) {
        const fromCheck = check('social', score, 14, rngFor(KEY), 0, 'life-a', 5, {
          prof,
          rolls: true,
        });
        const direct = roll('social', score, 14, rngFor(KEY), prof);
        expect(fromCheck.roll.dice).toEqual(direct.dice);
        expect(fromCheck.roll.mode).toBe(direct.mode);
        expect(fromCheck.roll.total).toBe(direct.total);
        expect(fromCheck.success).toBe(direct.success);
      }
    }
  });

  it('maps the mode and the dice count of every score', () => {
    const expected: Record<Score, { mode: string; dice: number }> = {
      1: { mode: 'dis', dice: 2 },
      2: { mode: 'dis', dice: 2 },
      3: { mode: 'flat', dice: 1 },
      4: { mode: 'adv', dice: 2 },
      5: { mode: 'adv', dice: 2 },
    };
    for (const score of SCORES) {
      const values = Array.from({ length: 2 }, () => face(10));
      const result = check('idle', score, 11, scripted(values), 0, 'life-a', 1, {
        prof: 0,
        rolls: true,
      });
      expect(result.roll.mode).toBe(expected[score].mode);
      expect(result.roll.dice).toHaveLength(expected[score].dice);
    }
  });

  it('rolls on refuses a proficiency outside 0 to 3 before it rolls', () => {
    const rng = scripted([face(1), face(1)]);
    expect(() => check('idle', 3, 11, rng, 0, 'life-a', 1, { prof: 4, rolls: true })).toThrow(
      RangeError,
    );
    expect(() => check('idle', 3, 11, rng, 0, 'life-a', 1, { prof: 1.5, rolls: false })).toThrow(
      RangeError,
    );
    expect(rng.draws).toBe(0);
  });

  it('the id is life key, tick, fx and n joined by colons', () => {
    const result = check('novelty', 4, 8, scripted([face(20), face(20)]), 7, 'life-z', 42, {
      prof: 0,
      rolls: true,
    });
    expect(result.roll.id).toBe('life-z:42:novelty:7');
  });
});

describe('package entry', () => {
  it('exports exactly the pinned names and not the temperament bank', () => {
    const pinned = [
      'STANDARD_SHEET',
      'alignmentLabel',
      'check',
      'decisionId',
      'exactChance',
      'factor',
      'levelForXp',
      'modeFor',
      'parseSheet',
      'roll',
      'rngFor',
      'step',
      'successChance',
      'successProbability',
      'ENGINE_VERSION',
      'canonicalSheetJson',
      'DEFAULT_DCS',
      'DEFAULT_THRESHOLDS',
      'normalizeSheet',
      'seedFor',
      'sheetOrStandard',
      'd20',
    ];
    expect(Object.keys(entry).sort()).toEqual([...pinned].sort());
    expect(Object.keys(entry)).not.toContain('TEMPERAMENT_BANK');
    expect(Object.keys(entry)).not.toContain('temperamentFor');
  });

  it('exports successProbability as the same function as successChance', () => {
    expect(successProbability).toBe(successChance);
    expect(entry.successProbability).toBe(entry.successChance);
    expect(entry.successProbability).toBe(successChance);
  });

  it('re-exports each engine name as the engine has it', () => {
    expect(entry.ENGINE_VERSION).toBe(engine.ENGINE_VERSION);
    expect(entry.normalizeSheet).toBe(engine.normalizeSheet);
    expect(entry.sheetOrStandard).toBe(engine.sheetOrStandard);
    expect(entry.seedFor).toBe(engine.seedFor);
    expect(entry.DEFAULT_DCS).toBe(engine.DEFAULT_DCS);
    expect(entry.DEFAULT_THRESHOLDS).toBe(engine.DEFAULT_THRESHOLDS);
    expect(entry.canonicalSheetJson).toBe(engine.canonicalSheetJson);
  });
});

/** The value a test passes where a Score is typed; check() must refuse it. */
function asScore(value: number): Score {
  return value as Score;
}

/** The error a call throws, or undefined when it does not throw. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('check input validation', () => {
  const both: readonly CheckOptions[] = [
    { prof: 0, rolls: true },
    { prof: 0, rolls: false },
  ];

  const refused: Array<[string, (opts: CheckOptions, rng: Rng) => unknown, string]> = [
    [
      'score 0',
      (o, r) => check('idle', asScore(0), 11, r, 0, 'life-a', 1, o),
      'score must be an integer from 1 to 5',
    ],
    [
      'score 6',
      (o, r) => check('idle', asScore(6), 11, r, 0, 'life-a', 1, o),
      'score must be an integer from 1 to 5',
    ],
    [
      'score 3.5',
      (o, r) => check('idle', asScore(3.5), 11, r, 0, 'life-a', 1, o),
      'score must be an integer from 1 to 5',
    ],
    [
      'score NaN',
      (o, r) => check('idle', asScore(Number.NaN), 11, r, 0, 'life-a', 1, o),
      'score must be an integer from 1 to 5',
    ],
    [
      'dc 10.5',
      (o, r) => check('idle', 3, 10.5, r, 0, 'life-a', 1, o),
      'dc must be a finite integer',
    ],
    [
      'dc NaN',
      (o, r) => check('idle', 3, Number.NaN, r, 0, 'life-a', 1, o),
      'dc must be a finite integer',
    ],
    [
      'dc Infinity',
      (o, r) => check('idle', 3, Number.POSITIVE_INFINITY, r, 0, 'life-a', 1, o),
      'dc must be a finite integer',
    ],
    [
      'n -1',
      (o, r) => check('idle', 3, 11, r, -1, 'life-a', 1, o),
      'n must be a safe non-negative integer',
    ],
    [
      'n 1.5',
      (o, r) => check('idle', 3, 11, r, 1.5, 'life-a', 1, o),
      'n must be a safe non-negative integer',
    ],
    [
      'n NaN',
      (o, r) => check('idle', 3, 11, r, Number.NaN, 'life-a', 1, o),
      'n must be a safe non-negative integer',
    ],
    [
      'tick -1',
      (o, r) => check('idle', 3, 11, r, 0, 'life-a', -1, o),
      'tick must be a safe non-negative integer',
    ],
    [
      'tick 2^53',
      (o, r) => check('idle', 3, 11, r, 0, 'life-a', Number.MAX_SAFE_INTEGER + 1, o),
      'tick must be a safe non-negative integer',
    ],
    [
      'fx empty',
      (o, r) => check('', 3, 11, r, 0, 'life-a', 1, o),
      'fx must be a non-empty string without ":"',
    ],
    [
      'fx with a colon',
      (o, r) => check('a:b', 3, 11, r, 0, 'life-a', 1, o),
      'fx must be a non-empty string without ":"',
    ],
    [
      'lifeKey empty',
      (o, r) => check('idle', 3, 11, r, 0, '', 1, o),
      'lifeKey must be a non-empty string without ":"',
    ],
    [
      'lifeKey with a colon',
      (o, r) => check('idle', 3, 11, r, 0, 'a:1', 1, o),
      'lifeKey must be a non-empty string without ":"',
    ],
  ];

  it('refuses each bad input with a RangeError and a constant message, before any draw', () => {
    for (const [label, attempt, message] of refused) {
      for (const opts of both) {
        const rng = scripted([face(1), face(1)]);
        const error = thrownBy(() => attempt(opts, rng));
        expect(error, `${label} rolls ${opts.rolls}`).toBeInstanceOf(RangeError);
        expect((error as RangeError).message, label).toBe(message);
        expect(rng.draws, `${label} rolls ${opts.rolls}`).toBe(0);
      }
    }
  });

  it('accepts the edges of every range', () => {
    const rng = scripted([]);
    const off: CheckOptions = { prof: 3, rolls: false };
    expect(thrownBy(() => check('idle', 1, -10, rng, 0, 'a', 0, off))).toBeUndefined();
    expect(
      thrownBy(() => check('idle', 5, 45, rng, Number.MAX_SAFE_INTEGER, 'z-9', 0, off)),
    ).toBeUndefined();
    expect(rng.draws).toBe(0);
  });
});
