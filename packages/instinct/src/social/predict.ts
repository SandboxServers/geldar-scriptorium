// Prediction by interpolation (HC-28a, D-CS-05). The other's estimated scores are fractional, but the policy only ever
// runs on integer sheets. A fractional field splits into its two adjacent integers, weighted by distance, and the
// prediction is the weighted sum of the outcome distributions over those sheets. Execution still runs on integers.
import type { CharacterSheet, Score } from '@geldar/scriptorium-psyche';
import { STANDARD_SHEET } from '@geldar/scriptorium-psyche';
import { type Branch, type Dist, distribution, type Prob } from './branch.ts';
import { estimateOf, type OtherModel } from './model.ts';
import type { Field } from './rules.ts';

export type Policy<I, T> = (sheet: CharacterSheet, input: I) => Branch<T>;

// The order sheetFrom reads the fields in: the four learned fields, then the two that are never learned.
const FIELDS: readonly Field[] = [
  'curiosity',
  'aggression',
  'law',
  'good',
  'common_sense',
  'cleverness',
];

interface Pick {
  value: Score;
  weight: number;
}

interface WeightedSheet {
  sheet: CharacterSheet;
  weight: number;
}

/** The estimate of every field: the model's estimate where it is learned, the prior everywhere else. */
export function estimatedScores(
  model: OtherModel | null,
  own: CharacterSheet | null,
): Record<Field, number> {
  const out = {} as Record<Field, number>;
  for (const f of FIELDS) out[f] = estimateOf(model, f, own).estimate;
  return out;
}

/** The adjacent integers of one estimate, with their weights. A whole estimate keeps only itself. */
function picksFor(v: number): Pick[] {
  if (!Number.isFinite(v) || v < 1 || v > 5) {
    throw new RangeError('estimate must be a number from 1 to 5');
  }
  const floor = Math.floor(v);
  const frac = v - floor;
  return [
    { value: floor as Score, weight: 1 - frac },
    { value: (floor + 1) as Score, weight: frac },
  ].filter((p) => p.weight > 0);
}

function sheetFrom(v: Record<Field, Score>): CharacterSheet {
  return {
    version: 1,
    attributes: {
      curiosity: v.curiosity,
      common_sense: v.common_sense,
      cleverness: v.cleverness,
      aggression: v.aggression,
    },
    alignment: { law: v.law, good: v.good },
    op_modes: { ...STANDARD_SHEET.op_modes },
  };
}

/** Every integer sheet the estimates touch, with the product of its weights. At most 2^6 = 64. */
function integerSheets(scores: Record<Field, number>): WeightedSheet[] {
  let rows: { values: Partial<Record<Field, Score>>; weight: number }[] = [
    { values: {}, weight: 1 },
  ];
  for (const f of FIELDS) {
    const picks = picksFor(scores[f]);
    rows = rows.flatMap((row) =>
      picks.map((p) => ({
        values: { ...row.values, [f]: p.value },
        weight: row.weight * p.weight,
      })),
    );
  }
  return rows.map((row) => ({
    sheet: sheetFrom(row.values as Record<Field, Score>),
    weight: row.weight,
  }));
}

/** The prediction for one choice: the policy run on each integer sheet, weighted and summed. */
export function predict<I, T>(
  policy: Policy<I, T>,
  scores: Record<Field, number>,
  input: I,
  p: Prob,
): Dist<T> {
  const out: Dist<T> = new Map();
  for (const { sheet, weight } of integerSheets(scores)) {
    for (const [outcome, chance] of distribution(policy(sheet, input), p)) {
      out.set(outcome, (out.get(outcome) ?? 0) + weight * chance);
    }
  }
  return out;
}

/** One prediction line through the injected appender. Nothing else is written. */
export function recordPrediction(
  append: (line: object) => void,
  other: string,
  fx: string,
  dist: Dist<string>,
  scores: Record<Field, number>,
  run: number,
): void {
  append({
    v: 1,
    ts: new Date().toISOString(),
    run,
    kind: 'prediction',
    other,
    fx,
    probs: Object.fromEntries(dist),
    est: scores,
  });
}
