// Novelty: a thing in view within the curiosity radius that the agent's own knowledge does not name may be noticed as
// new. Things come from the entities and notable blocks only; agents are never sightings (the guard meets those). A
// thing is marked seen before its roll, so it is rolled at most once. Facts only: never an act, never an escalation.
import type { Score } from '@geldar/scriptorium-psyche';
import { type Fx, type FxContext, sightingKey } from '../decide.ts';
import { makeFact } from '../facts.ts';
import { SEEN_MAX } from '../state.ts';

/** The most things rolled in one run. */
const PER_RUN_MAX = 2;
/** The notice radius for each curiosity score. */
const RADII: Record<Score, number> = { 1: 4, 2: 8, 3: 16, 4: 24, 5: 32 };

/** The distance within which a thing can be noticed, by the curiosity score. */
export function noticeRadius(curiosity: Score): number {
  return RADII[curiosity];
}

/** A thing in view: its kind and its distance, nearest first, within the radius. Null distances are never in view. */
function nearby(ctx: FxContext, radius: number): { kind: string; distance: number }[] {
  const things: { kind: string; distance: number }[] = [];
  for (const t of [...ctx.obs.entities, ...ctx.obs.notable]) {
    if (t.distance !== null && t.distance <= radius)
      things.push({ kind: t.kind, distance: t.distance });
  }
  return things.sort((a, b) => a.distance - b.distance);
}

/** True when the kind reads as a whole word in the known text; underscores read as spaces on both sides. */
function namedIn(kind: string, text: string): boolean {
  const word = kind.replace(/_/g, ' ').toLowerCase();
  if (word === '') return false;
  const haystack = text.toLowerCase().replace(/_/g, ' ');
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(haystack);
}

/** The novelty fx: up to two unseen, unnamed things in view are rolled; a success is one new_sighting fact. */
export const noveltyFx: Fx = (ctx) => {
  const { curiosity } = ctx.sheet.attributes;
  const facts: string[] = [];
  let rolled = 0;
  for (const thing of nearby(ctx, noticeRadius(curiosity))) {
    if (rolled >= PER_RUN_MAX) break;
    // The key is built from the kind name only: no id of any kind is read or stored.
    const key = sightingKey('thing', thing.kind);
    if (ctx.state.seen.includes(key) || namedIn(thing.kind, ctx.knownText)) continue;
    ctx.state.seen = [...ctx.state.seen, key].slice(-SEEN_MAX);
    rolled += 1;
    if (!ctx.check('novelty', curiosity, 11, 0).success) continue;
    const fact = makeFact('new_sighting', { name: thing.kind.replace(/_/g, ' ') });
    if (fact !== null) facts.push(fact);
  }
  return facts.length > 0 ? { kind: 'facts', fx: 'novelty', facts } : { kind: 'pass' };
};
