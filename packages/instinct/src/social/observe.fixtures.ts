// Test fixtures for the social observation tests (HC-27b). Not used by the step itself.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STANDARD_SHEET } from '@geldar/scriptorium-psyche';
import type { SocialEvent, SocialObservation, SocialSighting } from './observe.ts';

export const OBSERVER = 'observer-life';
export const OTHER = 'other-life';
export const OWN_SHEET = STANDARD_SHEET;

/** A fresh state directory under the OS temp folder. */
export function freshStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'social-observe-'));
}

/** Overrides that may name a field as undefined, which means the field is absent. */
type Overrides<T> = { [K in keyof T]?: T[K] | undefined };

/** The object without its undefined fields, so an absent field stays absent. */
function present<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** An event with a life-id actor, unless the overrides say otherwise. */
export function eventOf(overrides: Overrides<SocialEvent> = {}): SocialEvent {
  return present<SocialEvent>({
    kind: 'hurt',
    id: 'e1',
    tick: 100,
    actorName: 'Other Name',
    actorLife: OTHER,
    ...overrides,
  } as SocialEvent);
}

/** A nearby sighting at a distance, with a life id unless the overrides say otherwise. */
export function sightingOf(overrides: Overrides<SocialSighting> = {}): SocialSighting {
  return present<SocialSighting>({
    name: 'Other Name',
    life: OTHER,
    distance: 10,
    ...overrides,
  } as SocialSighting);
}

/** An observation for OBSERVER, unless the overrides say otherwise. */
export function obsOf(overrides: Partial<SocialObservation> = {}): SocialObservation {
  return {
    observer: OBSERVER,
    kind: 'hit_me',
    actor: OTHER,
    actorName: 'Other Name',
    key: 'hurt:e1',
    tick: 100,
    ...overrides,
  };
}
