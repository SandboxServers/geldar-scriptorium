// The per-other model: the estimate of each learned field of another life, from that life's observed acts (HC-27a).
// Estimates start at a prior projected from the observer's own sheet and move by a running mean that is pulled toward
// the prior by PRIOR_STRENGTH. Everything here is pure; the store in store.ts keeps the models on disk.
import type { CharacterSheet } from '@geldar/scriptorium-psyche';
import { type Field, type LearnedField, PRIOR_STRENGTH } from './rules.ts';

export interface FieldEstimate {
  estimate: number;
  n: number;
  tick: number;
}

export interface OtherModel {
  v: 1;
  observer: string;
  other: string;
  name: string;
  sightings: number;
  last_run: number;
  spoke: boolean;
  last_sample?: {
    tick: number;
    dist: number;
    me: [number, number, number];
    them?: [number, number, number];
  };
  fields: Partial<Record<LearnedField, FieldEstimate>>;
  updated_tick: number;
}

/** The observer's own score for a field. A missing sheet reads as the neutral 3 on every field. */
export function ownScore(sheet: CharacterSheet | null, f: Field): number {
  if (sheet === null) return 3;
  if (f === 'law' || f === 'good') return sheet.alignment[f];
  return sheet.attributes[f];
}

/** The prior for a field: 3 pulled toward the observer's own score, less when the observer has more common sense. */
export function priorFor(f: Field, own: CharacterSheet | null): number {
  const sense = ownScore(own, 'common_sense');
  const raw = 3 + 0.25 * (5 - sense) * (ownScore(own, f) - 3);
  return Math.min(5, Math.max(1, raw));
}

/** One observation folded into a running estimate: base + (evidence - base) / (n + strength), clamped to 1..5. */
export function applyEvidence(
  cur: FieldEstimate | undefined,
  prior: number,
  evidence: number,
  tick: number,
  strength: number = PRIOR_STRENGTH,
): FieldEstimate {
  const base = cur === undefined ? prior : cur.estimate;
  const n = cur === undefined ? 0 : cur.n;
  const raw = base + (evidence - base) / (n + strength);
  const clamped = Math.min(5, Math.max(1, raw));
  return { estimate: Math.round(clamped * 1e6) / 1e6, n: n + 1, tick };
}

/**
 * The read of one field. A field with no rule (common_sense, cleverness) is always its prior and never supported.
 * A learned field is supported once at least one observation has moved it.
 */
export function estimateOf(
  m: OtherModel | null,
  f: Field,
  own: CharacterSheet | null,
): { estimate: number; n: number; supported: boolean } {
  const prior = priorFor(f, own);
  if (f === 'common_sense' || f === 'cleverness')
    return { estimate: prior, n: 0, supported: false };
  const fe = m?.fields[f];
  if (fe === undefined) return { estimate: prior, n: 0, supported: false };
  return { estimate: fe.estimate, n: fe.n, supported: fe.n > 0 };
}
