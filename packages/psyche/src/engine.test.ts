// Conformance of the vendored engine to the card's examples. The roll table is computed by feeding roll()
// every dice outcome from a scripted Rng, so a change to the dice rule fails here.
import { describe, expect, it } from 'vitest';
import {
  alignmentLabel,
  type DrawKey,
  decisionId,
  exactChance,
  factor,
  modeFor,
  type Rng,
  rngFor,
  roll,
  type Score,
  STANDARD_SHEET,
  step,
} from '../engine/index.ts';

const SCORES: readonly Score[] = [1, 2, 3, 4, 5];
const DCS = [8, 11, 14, 17] as const;

/** Brief 4.1: the chance in whole percent, per score (rows) and DC 8, 11, 14, 17 (columns). */
const TABLE: Record<Score, readonly number[]> = {
  1: [30, 16, 6, 1],
  2: [42, 25, 12, 4],
  3: [65, 50, 35, 20],
  4: [88, 75, 58, 36],
  5: [94, 84, 70, 51],
};

/** An Rng that returns the given values in order. */
function scripted(values: number[]): Rng {
  let index = 0;
  return {
    next(): number {
      const value = values[index];
      if (value === undefined) throw new Error('scripted rng exhausted');
      index += 1;
      return value;
    },
    get draws(): number {
      return index;
    },
  };
}

/** The value whose d20 is face k: floor(((k - 0.5) / 20) * 20) + 1 = k. */
const faceValue = (k: number): number => (k - 0.5) / 20;

/** Every dice outcome of the score's mode: 20 for flat, 400 for disadvantage and advantage. */
function outcomes(score: Score): number[][] {
  const faces = Array.from({ length: 20 }, (_, index) => index + 1);
  return modeFor(score).mode === 'flat'
    ? faces.map((face) => [face])
    : faces.flatMap((first) => faces.map((second) => [first, second]));
}

function percentByRolls(score: Score, dc: number): number {
  const all = outcomes(score);
  let wins = 0;
  for (const dice of all) {
    if (roll('check', score, dc, scripted(dice.map(faceValue))).success) wins += 1;
  }
  return Math.round((wins * 100) / all.length);
}

function drawsOf(key: DrawKey): number[] {
  const rng = rngFor(key);
  return Array.from({ length: 10 }, () => rng.next());
}

const KEY: DrawKey = {
  lifeId: 'life-1',
  producer: 'body',
  generation: 0,
  tick: 0,
  fx: 'roll',
  decisionSeq: 0,
};

describe('engine', () => {
  it('engine: roll table matches brief 4.1', () => {
    for (const score of SCORES) {
      DCS.forEach((dc, column) => {
        const expected = TABLE[score][column];
        expect(percentByRolls(score, dc), `score ${score} dc ${dc}`).toBe(expected);
        const exact = exactChance(score, dc);
        expect(Math.round((exact.wins * 100) / exact.total), `exact ${score} dc ${dc}`).toBe(
          expected,
        );
      });
    }
  });

  it('engine: step floors 10 8 6 4 2', () => {
    expect(SCORES.map((score) => step(score, 6, -2, 2, 14))).toEqual([10, 8, 6, 4, 2]);
  });

  it('engine: factor is base times k to the power of score minus 3', () => {
    expect(SCORES.map((score) => factor(score, 1, 2))).toEqual([0.25, 0.5, 1, 2, 4]);
  });

  it('engine: alignment labels at the corners and the centre', () => {
    expect(alignmentLabel(3, 3)).toBe('TN');
    expect(alignmentLabel(5, 5)).toBe('LG');
    expect(alignmentLabel(1, 1)).toBe('CE');
  });

  it('engine: STANDARD_SHEET has every score at 3', () => {
    const scores = [
      ...Object.values(STANDARD_SHEET.attributes),
      ...Object.values(STANDARD_SHEET.alignment),
      ...Object.values(STANDARD_SHEET.op_modes),
    ];
    expect(scores.length).toBe(4 + 2 + 7);
    expect(scores.every((score) => score === 3)).toBe(true);
  });

  it('engine: rngFor is reproducible per key and a new tick gives new draws', () => {
    expect(drawsOf(KEY)).toEqual(drawsOf(KEY));
    expect(drawsOf({ ...KEY, tick: 1 })).not.toEqual(drawsOf(KEY));
  });

  it('engine: decisionId joins the six key fields with colons', () => {
    expect(decisionId(KEY)).toBe('body:life-1:0:0:roll:0');
  });

  it('engine: alignment reads law first and good second, with the 4 and 3 boundaries', () => {
    expect(alignmentLabel(5, 1)).toBe('LE');
    expect(alignmentLabel(1, 5)).toBe('CG');
    expect(alignmentLabel(4, 2)).toBe('LE');
    expect(alignmentLabel(2, 4)).toBe('CG');
    expect(alignmentLabel(4, 3)).toBe('LN');
    expect(alignmentLabel(3, 4)).toBe('TG');
  });

  it('engine: modeFor puts 1 and 2 on disadvantage, 3 on flat and 4 and 5 on advantage', () => {
    expect(modeFor(2).mode).toBe('dis');
    expect(modeFor(3).mode).toBe('flat');
    expect(modeFor(4).mode).toBe('adv');
    expect(modeFor(5).mode).toBe('adv');
  });

  it('engine: step clamps at the minimum and at the maximum', () => {
    expect(step(5, 6, -2, 4, 14)).toBe(4);
    expect(step(1, 6, 3, 2, 8)).toBe(2);
    expect(step(1, 6, -3, 2, 8)).toBe(8);
    expect(step(5, 6, 3, 2, 8)).toBe(8);
    expect(step(3, 6, -2, 2, 14)).toBe(6);
  });

  it('engine: proficiency adds to the bonus of a roll and of the exact chance', () => {
    const plain = roll('check', 3, 11, scripted([faceValue(10)]));
    expect(plain.bonus).toBe(0);
    expect(plain.total).toBe(10);
    expect(plain.success).toBe(false);
    const skilled = roll('check', 3, 11, scripted([faceValue(10)]), 2);
    expect(skilled.bonus).toBe(2);
    expect(skilled.total).toBe(12);
    expect(skilled.success).toBe(true);
    expect(exactChance(3, 11, 1)).toEqual({ wins: 11, total: 20 });
  });
});
