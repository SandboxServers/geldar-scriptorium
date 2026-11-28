import type { CharacterSheet, Score } from '@geldar/scriptorium-psyche';
import { describe, expect, it } from 'vitest';
import { applyEvidence, estimateOf, type OtherModel, ownScore, priorFor } from './model.ts';
import { OBS_RULES } from './rules.ts';

function sheetWith(curiosity: Score, commonSense: Score): CharacterSheet {
  return {
    version: 1,
    attributes: { curiosity, common_sense: commonSense, cleverness: 3, aggression: 3 },
    alignment: { law: 3, good: 3 },
    op_modes: { explorer: 3, farmer: 3, miner: 3, builder: 3, crafter: 3, warrior: 3, nitwit: 3 },
  };
}

function modelWith(fields: OtherModel['fields']): OtherModel {
  return {
    v: 1,
    observer: 'me',
    other: 'x',
    name: 'X',
    sightings: 1,
    last_run: 0,
    spoke: false,
    fields,
    updated_tick: 1,
  };
}

describe('social model', () => {
  it('evidence 4.5 applied three times from prior 3 gives 3.75, 4.0, 4.125', () => {
    const a = applyEvidence(undefined, 3, 4.5, 1);
    const b = applyEvidence(a, 3, 4.5, 2);
    const c = applyEvidence(b, 3, 4.5, 3);
    expect([a.estimate, b.estimate, c.estimate]).toEqual([3.75, 4, 4.125]);
    expect(c.n).toBe(3);
  });

  it('the prior projects from the own sheet: common sense 1 and curiosity 5 give 5', () => {
    expect(priorFor('curiosity', sheetWith(5, 1))).toBe(5);
  });

  it('the prior projects from the own sheet: common sense 5 gives 3', () => {
    expect(priorFor('curiosity', sheetWith(5, 5))).toBe(3);
  });

  it('the prior projects from the own sheet: common sense 3 gives 4', () => {
    expect(priorFor('curiosity', sheetWith(5, 3))).toBe(4);
  });

  it('with no sheet every field reads as the neutral 3', () => {
    expect(ownScore(null, 'law')).toBe(3);
    expect(priorFor('curiosity', null)).toBe(3);
  });

  it('estimates clamp to 1 and 5', () => {
    expect(applyEvidence(undefined, 3, 9, 1).estimate).toBe(5);
    expect(applyEvidence(undefined, 1, 0, 1).estimate).toBe(1);
  });

  it('unlearned fields stay unsupported even after other updates', () => {
    const m = modelWith({ curiosity: { estimate: 4, n: 1, tick: 1 } });
    expect(estimateOf(m, 'curiosity', null).supported).toBe(true);
    expect(estimateOf(m, 'aggression', null).supported).toBe(false);
    expect(estimateOf(m, 'common_sense', sheetWith(5, 1)).supported).toBe(false);
    expect(estimateOf(m, 'cleverness', null).supported).toBe(false);
  });

  it('inactive rules are marked off and the active ones are on', () => {
    for (const kind of ['fled_mob', 'kept_promise', 'broke_promise'] as const)
      expect(OBS_RULES[kind].active).toBe(false);
    for (const kind of [
      'spoke_first',
      'approached',
      'kept_away',
      'hit_me',
      'gave_me',
      'took_mine',
      'fought_mob',
    ] as const)
      expect(OBS_RULES[kind].active).toBe(true);
    expect(OBS_RULES.took_mine.updates).toEqual([
      { field: 'law', value: 1.5 },
      { field: 'good', value: 2 },
    ]);
  });

  it('a fight_seen rule is aggression 4.5 only, and fled_mob stays inactive', () => {
    expect(OBS_RULES.fought_mob).toEqual({
      active: true,
      updates: [{ field: 'aggression', value: 4.5 }],
    });
    expect(OBS_RULES.fled_mob.active).toBe(false);
  });
});
