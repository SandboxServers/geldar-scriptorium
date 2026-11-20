import { type CharacterSheet, successProbability } from '@geldar/scriptorium-psyche';
import { describe, expect, it, vi } from 'vitest';
import { type Branch, distribution, type Prob } from './branch.ts';
import { estimatedScores, type Policy, predict, recordPrediction } from './predict.ts';
import type { Field } from './rules.ts';

function scoresWith(over: Partial<Record<Field, number>>): Record<Field, number> {
  return {
    curiosity: 3,
    aggression: 3,
    law: 3,
    good: 3,
    common_sense: 3,
    cleverness: 3,
    ...over,
  };
}

// One check on aggression: fight on a success, walk away on a failure.
const fightOrWalk: Policy<null, string> = (sheet) => ({
  kind: 'chance',
  chance: { score: sheet.attributes.aggression, dc: 10, proficiency: 0 },
  success: { kind: 'outcome', outcome: 'fight' },
  failure: { kind: 'outcome', outcome: 'walk' },
});

// A test double for the chance: score 1 never succeeds, score 5 always does.
const linear: Prob = (c) => (c.score - 1) / 4;

function allScores(sheet: CharacterSheet): number[] {
  return [...Object.values(sheet.attributes), ...Object.values(sheet.alignment)];
}

describe('prediction by interpolation', () => {
  it('aggression 3.5 with a test-double policy gives P(fight) 0.625', () => {
    const dist = predict(fightOrWalk, scoresWith({ aggression: 3.5 }), null, linear);
    expect(dist.get('fight')).toBeCloseTo(0.625, 12);
    expect(dist.get('walk')).toBeCloseTo(0.375, 12);
  });

  it('an integer estimate calls the policy once', () => {
    const spy = vi.fn(fightOrWalk);
    predict(spy, scoresWith({ curiosity: 4, aggression: 2 }), null, linear);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('one fractional field calls it exactly twice (spy)', () => {
    const spy = vi.fn(fightOrWalk);
    predict(spy, scoresWith({ aggression: 3.5 }), null, linear);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('the policy only sees integers', () => {
    const seen: CharacterSheet[] = [];
    const watch: Policy<null, string> = (sheet, input) => {
      seen.push(sheet);
      return fightOrWalk(sheet, input);
    };
    predict(watch, scoresWith({ curiosity: 2.25, law: 4.75, good: 1.5 }), null, linear);
    expect(seen.length).toBeGreaterThan(1);
    for (const sheet of seen) {
      for (const value of allScores(sheet)) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(5);
      }
    }
  });

  it('two fractional fields enumerate four sheets with product weights', () => {
    const spy = vi.fn<Policy<null, string>>((sheet) => ({
      kind: 'outcome',
      outcome: `${sheet.attributes.curiosity}-${sheet.attributes.aggression}`,
    }));
    const dist = predict(spy, scoresWith({ curiosity: 2.25, aggression: 3.5 }), null, linear);
    expect(spy).toHaveBeenCalledTimes(4);
    expect(dist.get('2-3')).toBeCloseTo(0.375, 12);
    expect(dist.get('2-4')).toBeCloseTo(0.375, 12);
    expect(dist.get('3-3')).toBeCloseTo(0.125, 12);
    expect(dist.get('3-4')).toBeCloseTo(0.125, 12);
    const total = [...dist.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 12);
  });

  it('distribution sums to 1 on nested chances', () => {
    const tree: Branch<string> = {
      kind: 'chance',
      chance: { score: 2, dc: 12, proficiency: 1 },
      success: {
        kind: 'chance',
        chance: { score: 4, dc: 8, proficiency: 2 },
        success: { kind: 'outcome', outcome: 'a' },
        failure: { kind: 'outcome', outcome: 'b' },
      },
      failure: {
        kind: 'chance',
        chance: { score: 5, dc: 15, proficiency: 0 },
        success: { kind: 'outcome', outcome: 'c' },
        failure: { kind: 'outcome', outcome: 'd' },
      },
    };
    const dist = distribution(tree, (c) => successProbability(c.score, c.dc, c.proficiency));
    const total = [...dist.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 12);
    expect(dist.size).toBe(4);
  });

  it('engine fixtures: successProbability(3, 11, 0) is 0.5 and (1, 8, 0) is 121/400', () => {
    expect(successProbability(3, 11, 0)).toBeCloseTo(0.5, 12);
    expect(successProbability(1, 8, 0)).toBeCloseTo(121 / 400, 12);
  });

  it('a prediction line has the fixed shape and goes only through the appender', () => {
    const append = vi.fn<(line: object) => void>();
    const dist = new Map([
      ['fight', 0.625],
      ['walk', 0.375],
    ]);
    const scores = scoresWith({ aggression: 3.5 });
    recordPrediction(append, 'ann-1', 'stranger', dist, scores, 7);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]?.[0]).toEqual({
      v: 1,
      ts: expect.any(String),
      run: 7,
      kind: 'prediction',
      other: 'ann-1',
      fx: 'stranger',
      probs: { fight: 0.625, walk: 0.375 },
      est: scores,
    });
  });

  it('estimatedScores reads the prior for every field when nothing is learned', () => {
    expect(estimatedScores(null, null)).toEqual(scoresWith({}));
  });

  it('rejects an estimate outside 1 to 5', () => {
    expect(() => predict(fightOrWalk, scoresWith({ aggression: 5.5 }), null, linear)).toThrow(
      RangeError,
    );
  });
});
