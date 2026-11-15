// successChance against the engine's enumeration and the brief 4.1 table, check() with rolls off and on, and the
// names the package entry exposes.
import { describe, expect, it } from 'vitest';
import {
  type DrawKey,
  exactChance,
  type Level,
  type Rng,
  rngFor,
  roll,
  type Score,
} from '../engine/index.ts';
import { check, successChance } from './check.ts';
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
    ];
    expect(Object.keys(entry).sort()).toEqual([...pinned].sort());
    expect(Object.keys(entry)).not.toContain('TEMPERAMENT_BANK');
    expect(Object.keys(entry)).not.toContain('temperamentFor');
  });
});
