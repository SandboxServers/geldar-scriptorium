import {
  type CharacterSheet,
  type Roll,
  type Score,
  STANDARD_SHEET,
  successProbability,
} from '@geldar/scriptorium-psyche';
import { describe, expect, it, vi } from 'vitest';
import { distribution, type Prob } from './branch.ts';
import {
  FOLLOW_LIMIT,
  type StrangerInput,
  type StrangerOutcome,
  strangerBranch,
  strangerStep,
} from './stranger.ts';

// Our own sheet with the fields the policy reads; every other score is the neutral 3.
function sheet(over: { curiosity?: Score; aggression?: Score; good?: Score } = {}): CharacterSheet {
  return {
    version: 1,
    attributes: {
      curiosity: over.curiosity ?? 3,
      common_sense: 3,
      cleverness: 3,
      aggression: over.aggression ?? 3,
    },
    alignment: { law: 3, good: over.good ?? 3 },
    op_modes: { ...STANDARD_SHEET.op_modes },
  };
}

function inputOf(over: Partial<StrangerInput> = {}): StrangerInput {
  return {
    own: sheet(),
    socialProficiency: 0,
    other: { id: 'stranger-life', name: 'Ann', distance: 10, estAggression: 3 },
    sightings: 2,
    hasPeopleFile: false,
    followsSoFar: 0,
    rollsOn: false,
    ...over,
  };
}

// The production chance: the psyche success probability of one check.
const prob: Prob = (c) => successProbability(c.score, c.dc, c.proficiency);

function fakeRoll(success: boolean, score: Score, dc: number): Roll {
  return {
    fx: 'stranger',
    score,
    proficiency: 0,
    dc,
    mode: 'flat',
    dice: [success ? 20 : 1],
    kept: success ? 20 : 1,
    bonus: 0,
    total: success ? 20 : 1,
    success,
  };
}

describe('strangerBranch', () => {
  it('avoid when threat is 2 or more', () => {
    const b = strangerBranch(
      inputOf({ other: { id: 'x', name: 'Ann', distance: 9, estAggression: 5 } }),
    );
    expect(b).toEqual({ kind: 'outcome', outcome: 'avoid' });
  });

  it('own aggression lowers the threat below the line', () => {
    const b = strangerBranch(
      inputOf({
        own: sheet({ aggression: 4 }),
        other: { id: 'x', name: 'Ann', distance: 9, estAggression: 5 },
      }),
    );
    expect(b.kind).toBe('chance');
  });

  it('approach when approach is 1 or more without a roll', () => {
    expect(strangerBranch(inputOf({ own: sheet({ curiosity: 4, good: 4 }) }))).toEqual({
      kind: 'outcome',
      outcome: 'approach',
    });
  });

  it('social proficiency adds half a point to approach', () => {
    const b = strangerBranch(inputOf({ socialProficiency: 2 }));
    expect(b).toEqual({ kind: 'outcome', outcome: 'approach' });
  });

  it('ignore when approach is below -1', () => {
    expect(strangerBranch(inputOf({ own: sheet({ curiosity: 1, good: 1 }) }))).toEqual({
      kind: 'outcome',
      outcome: 'ignore',
    });
  });

  it('chance node only between -1 and 1', () => {
    const b = strangerBranch(inputOf());
    expect(b).toEqual({
      kind: 'chance',
      chance: { score: 3, dc: 11, proficiency: 0 },
      success: { kind: 'outcome', outcome: 'approach' },
      failure: { kind: 'outcome', outcome: 'ignore' },
    });
    const dist = distribution(b, prob);
    expect(dist.get('approach')).toBeCloseTo(0.5, 12);
    expect(dist.get('ignore')).toBeCloseTo(0.5, 12);
    // Exactly -1 is still a chance node; exactly 1 is a fixed approach.
    expect(strangerBranch(inputOf({ own: sheet({ curiosity: 2, good: 3 }) })).kind).toBe('chance');
    expect(strangerBranch(inputOf({ own: sheet({ curiosity: 4, good: 3 }) }))).toEqual({
      kind: 'outcome',
      outcome: 'approach',
    });
  });
});

describe('strangerStep gates', () => {
  // Settings that would settle a follow if no gate applied.
  const eager = { own: sheet({ curiosity: 5, good: 5 }) };

  it('first sighting passes', () => {
    const roll = vi.fn(() => null);
    const out = strangerStep(inputOf({ ...eager, sightings: 0 }), roll, prob);
    expect(out).toEqual({ outcome: { kind: 'pass' }, rolls: [] });
    expect(roll).not.toHaveBeenCalled();
  });

  it('a person with a people file passes', () => {
    const angry = { other: { id: 'x', name: 'Ann', distance: 9, estAggression: 5 } };
    const out = strangerStep(inputOf({ ...angry, hasPeopleFile: true }), () => null, prob);
    expect(out.outcome).toEqual({ kind: 'pass' });
  });

  it('a second sighting is no longer a first sighting', () => {
    const out = strangerStep(inputOf({ ...eager, sightings: 1 }), () => null, prob);
    expect(out.outcome.kind).toBe('settle');
  });
});

describe('strangerStep choice', () => {
  it('rolls off picks the more probable choice and consumes no roll', () => {
    const roll = vi.fn(() => null);
    const high: Prob = () => 0.9;
    const out = strangerStep(inputOf({ rollsOn: false }), roll, high);
    expect(out.outcome).toEqual({
      kind: 'settle',
      act: { kind: 'follow', target: 'stranger-life' },
      why: expect.any(String),
    });
    expect(out.rolls).toEqual([]);
    expect(roll).not.toHaveBeenCalled();
  });

  it('a tie between approach and ignore picks ignore', () => {
    const out = strangerStep(inputOf(), () => null, prob);
    expect(out.outcome).toEqual({ kind: 'pass' });
  });

  it('rolls on records exactly one roll', () => {
    const roll = vi.fn((score: Score, dc: number) => fakeRoll(true, score, dc));
    const out = strangerStep(inputOf({ rollsOn: true }), roll, prob);
    expect(roll).toHaveBeenCalledTimes(1);
    expect(roll).toHaveBeenCalledWith(3, 11);
    expect(out.rolls).toHaveLength(1);
    expect(out.outcome.kind).toBe('settle');
  });

  it('rolls on with a failed check takes ignore and still records one roll', () => {
    const roll = (score: Score, dc: number): Roll => fakeRoll(false, score, dc);
    const out = strangerStep(inputOf({ rollsOn: true }), roll, prob);
    expect(out.rolls).toHaveLength(1);
    expect(out.outcome).toEqual({ kind: 'pass' });
  });

  it('a null roll passes, so the model decides', () => {
    const out = strangerStep(inputOf({ rollsOn: true }), () => null, prob);
    expect(out).toEqual({ outcome: { kind: 'pass' }, rolls: [] });
  });

  it('avoid settles travel_away', () => {
    const out = strangerStep(
      inputOf({ other: { id: 'stranger-life', name: 'Ann', distance: 10, estAggression: 5 } }),
      () => null,
      prob,
    );
    expect(out.outcome).toEqual({
      kind: 'settle',
      act: { kind: 'travel_away', target: 'stranger-life' },
      why: expect.any(String),
    });
  });
});

describe('strangerStep approach', () => {
  const eager = { own: sheet({ curiosity: 5, good: 5 }) };

  it('within 4 blocks escalates, never settles', () => {
    for (const distance of [1, 3, 4]) {
      const other = { id: 'x', name: 'Ann', distance, estAggression: 3 };
      const out = strangerStep(inputOf({ ...eager, other }), () => null, prob);
      expect(out.outcome.kind).toBe('escalate');
    }
  });

  it('beyond 4 blocks settles a follow', () => {
    const other = { id: 'x', name: 'Ann', distance: 5, estAggression: 3 };
    const out = strangerStep(inputOf({ ...eager, other }), () => null, prob);
    expect(out.outcome.kind).toBe('settle');
  });

  it('the third follow escalates', () => {
    expect(FOLLOW_LIMIT).toBe(3);
    const two = strangerStep(inputOf({ ...eager, followsSoFar: 2 }), () => null, prob);
    expect(two.outcome.kind).toBe('settle');
    const three = strangerStep(inputOf({ ...eager, followsSoFar: 3 }), () => null, prob);
    expect(three.outcome.kind).toBe('escalate');
  });

  it('no text of the outcome reaches the character', () => {
    const cases: StrangerOutcome[] = [
      strangerStep(inputOf({ ...eager }), () => null, prob).outcome,
      strangerStep(inputOf({ ...eager, followsSoFar: 3 }), () => null, prob).outcome,
      strangerStep(inputOf({ sightings: 0 }), () => null, prob).outcome,
      strangerStep(
        inputOf({ other: { id: 'x', name: 'Ann', distance: 9, estAggression: 5 } }),
        () => null,
        prob,
      ).outcome,
    ];
    for (const out of cases) {
      const keys = Object.keys(out);
      expect(keys).not.toContain('facts');
      expect(keys).not.toContain('text');
      expect(JSON.stringify(out)).not.toMatch(/"(facts|text)"/);
    }
  });
});
