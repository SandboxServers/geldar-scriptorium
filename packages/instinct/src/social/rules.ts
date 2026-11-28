// The social rules: which observed acts move which learned field of another life's model, and to what value (HC-27a).
// Only the four learned fields have rules. common_sense and cleverness are never learned; they are read as their prior.
// Inactive rules are recorded for their cards and never applied: fled_mob has no causal signal, and the promise pair
// waits for AN-48.

export const LEARNED_FIELDS = ['curiosity', 'aggression', 'law', 'good'] as const;
export type LearnedField = (typeof LEARNED_FIELDS)[number];
export type Field = LearnedField | 'common_sense' | 'cleverness';

// The weight of the prior, in observations. Unmeasured; assumed under D-CS-05.
export const PRIOR_STRENGTH = 2;

export type ObsKind =
  | 'spoke_first'
  | 'approached'
  | 'kept_away'
  | 'hit_me'
  | 'gave_me'
  | 'took_mine'
  | 'fought_mob'
  | 'fled_mob'
  | 'kept_promise'
  | 'broke_promise';

export interface Update {
  field: LearnedField;
  value: number;
}

export interface ObsRule {
  active: boolean;
  updates: readonly Update[];
}

export const OBS_RULES: Readonly<Record<ObsKind, ObsRule>> = {
  spoke_first: { active: true, updates: [{ field: 'curiosity', value: 4.0 }] },
  approached: { active: true, updates: [{ field: 'curiosity', value: 3.5 }] },
  kept_away: { active: true, updates: [{ field: 'curiosity', value: 2.5 }] },
  hit_me: { active: true, updates: [{ field: 'aggression', value: 4.5 }] },
  gave_me: { active: true, updates: [{ field: 'good', value: 4.5 }] },
  took_mine: {
    active: true,
    updates: [
      { field: 'law', value: 1.5 },
      { field: 'good', value: 2.0 },
    ],
  },
  fought_mob: { active: true, updates: [{ field: 'aggression', value: 4.5 }] },
  fled_mob: { active: false, updates: [{ field: 'aggression', value: 1.5 }] },
  kept_promise: { active: false, updates: [{ field: 'law', value: 4.5 }] },
  broke_promise: { active: false, updates: [{ field: 'law', value: 1.5 }] },
};
