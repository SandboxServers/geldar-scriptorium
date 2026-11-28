// Applies social observations to one observer's models (HC-27b). Each observation is checked for its observer (foreign),
// its actor (self), its rule (inactive) and its actor id (badId). Then each rule field is applied once: a key already in
// the seen set counts as deduped. Observations are applied in tick and key order, so any batch order gives the same
// models. Only counts leave this module; no event, name or sheet is written anywhere but the models.
import type { CharacterSheet } from '@geldar/scriptorium-psyche';
import type { SeenSet } from './dedup.ts';
import { applyEvidence, type OtherModel, priorFor } from './model.ts';
import { cleanName, type SocialObservation } from './observe.ts';
import { OBS_RULES } from './rules.ts';
import { SAFE_ID, type SocialStore } from './store.ts';

/**
 * The counts of one batch. `applied` counts observations that moved at least one model field; `deduped` counts
 * observations whose every field was already seen; `dropped` counts observations refused before any field was read.
 */
export interface ApplyReport {
  applied: number;
  deduped: number;
  dropped: { foreign: number; self: number; inactive: number; badId: number };
}

function emptyReport(): ApplyReport {
  return { applied: 0, deduped: 0, dropped: { foreign: 0, self: 0, inactive: 0, badId: 0 } };
}

function byTickThenKey(a: SocialObservation, b: SocialObservation): number {
  if (a.tick !== b.tick) return a.tick - b.tick;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  if (a.actor !== b.actor) return a.actor < b.actor ? -1 : 1;
  return 0;
}

function newModel(
  observer: string,
  other: string,
  name: string,
  run: number,
  tick: number,
): OtherModel {
  return {
    v: 1,
    observer,
    other,
    name: cleanName(name),
    sightings: 0,
    last_run: run,
    spoke: false,
    fields: {},
    updated_tick: tick,
  };
}

/** Applies one batch of observations for `observer`. Returns counts only. */
export function applyObservations(
  store: SocialStore,
  seen: SeenSet,
  own: CharacterSheet | null,
  observer: string,
  obs: readonly SocialObservation[],
  run: number,
  strength?: number,
): ApplyReport {
  const report = emptyReport();
  let added = false;
  for (const o of [...obs].sort(byTickThenKey)) {
    if (o.observer !== observer) {
      report.dropped.foreign++;
      continue;
    }
    if (o.actor === observer) {
      report.dropped.self++;
      continue;
    }
    const rule = OBS_RULES[o.kind];
    if (!rule.active) {
      report.dropped.inactive++;
      continue;
    }
    if (!SAFE_ID.test(o.actor)) {
      report.dropped.badId++;
      continue;
    }
    const model = store.load(o.actor) ?? newModel(observer, o.actor, o.actorName, run, o.tick);
    let moved = false;
    let skipped = false;
    for (const u of rule.updates) {
      const key = `${o.key}#${u.field}`;
      if (seen.has(key)) {
        skipped = true;
        continue;
      }
      seen.add(key);
      added = true;
      model.fields[u.field] = applyEvidence(
        model.fields[u.field],
        priorFor(u.field, own),
        u.value,
        o.tick,
        strength,
      );
      moved = true;
    }
    if (moved) {
      model.updated_tick = o.tick;
      if (o.kind === 'spoke_first') model.spoke = true;
      store.save(model);
      report.applied++;
    } else if (skipped) {
      report.deduped++;
    }
  }
  if (added) seen.flush();
  return report;
}

/**
 * Counts one sighting of an other that already has a model. A model is not created here: the observer's name is private
 * to the store, and a model is first made by an applied observation. An unsafe id is ignored.
 */
export function noteSighting(store: SocialStore, other: string, name: string, run: number): void {
  if (!SAFE_ID.test(other)) return;
  const model = store.load(other);
  if (model === null) return;
  model.sightings += 1;
  model.last_run = run;
  model.name = cleanName(name);
  store.save(model);
}

/** Stores the last position sample of an other, creating its model when none exists. An unsafe id is ignored. */
export function noteSample(
  store: SocialStore,
  observer: string,
  other: string,
  name: string,
  run: number,
  sample: NonNullable<OtherModel['last_sample']>,
): void {
  if (!SAFE_ID.test(other)) return;
  const model = store.load(other) ?? newModel(observer, other, name, run, sample.tick);
  model.last_sample = sample;
  store.save(model);
}
