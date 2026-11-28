// Which learned traits of nearby others reach the prompt, and the bounded lines that carry them (HC-29).
// Inactive by default: nearbyFacts returns [] unless its caller passes enabled as true (HC-30a reads the env switch).
import type { CharacterSheet } from '@geldar/scriptorium-psyche';
import { estimateOf, type OtherModel } from './model.ts';
import { renderLine } from './prose.ts';
import { LEARNED_FIELDS, type LearnedField } from './rules.ts';

export interface Candidate {
  name: string;
  field: LearnedField;
  dir: 'high' | 'low';
  dist: number;
}

const NEUTRAL = 3;
const MIN_DIST = 0.75;
const MAX_LINES = 2;

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The learned traits worth saying: a field must have at least one observation and sit at least 0.75 from neutral.
 * Order: larger distance, then name, then field order. Only the first max candidates are kept.
 */
export function selectTraits(
  models: readonly OtherModel[],
  own: CharacterSheet | null,
  max: number = MAX_LINES,
): Candidate[] {
  const found: Candidate[] = [];
  for (const m of models) {
    if (typeof m.name !== 'string') continue;
    for (const f of LEARNED_FIELDS) {
      const est = estimateOf(m, f, own);
      if (typeof est.estimate !== 'number' || !(est.n >= 1)) continue;
      const dist = Math.abs(est.estimate - NEUTRAL);
      if (!(dist >= MIN_DIST)) continue;
      found.push({ name: m.name, field: f, dir: est.estimate > NEUTRAL ? 'high' : 'low', dist });
    }
  }
  found.sort(
    (a, b) =>
      b.dist - a.dist ||
      byName(a.name, b.name) ||
      LEARNED_FIELDS.indexOf(a.field) - LEARNED_FIELDS.indexOf(b.field),
  );
  return found.slice(0, max);
}

/** The prompt lines for the others nearby. Returns [] unless enabled is exactly true, whatever the input. */
export function nearbyFacts(
  models: readonly OtherModel[],
  nearby: readonly { id: string }[],
  own: CharacterSheet | null,
  enabled: boolean,
): string[] {
  if (enabled !== true) return [];
  const ids = new Set(nearby.map((n) => n.id));
  const here = models.filter((m) => ids.has(m.other));
  return selectTraits(here, own).map((c) => renderLine(c.name, c.field, c.dir));
}
