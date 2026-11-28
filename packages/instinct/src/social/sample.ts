// Position sampling for a nearby other (HC-27b): approached or kept_away, read from two samples of distance. Both the
// observer and the other must have stood still enough between the samples. The constants are unmeasured. Pure: the
// caller stores the returned sample (noteSample in apply.ts).
import type { OtherModel } from './model.ts';
import { cleanName, type SocialObservation, type SocialSighting } from './observe.ts';
import type { ObsKind } from './rules.ts';

/** The ticks in one sampling bucket; the dedup key of a position observation is per bucket. Unmeasured. */
export const SAMPLE_TICKS = 6000;
/** The fewest ticks between two samples that give an observation. Unmeasured. */
export const MIN_GAP_TICKS = 100;
/** The fewest blocks the other must move between samples to count as moving. Unmeasured. */
export const MOVE_BLOCKS = 6;
/** The most blocks the observer may move between samples and still read the other's movement. Unmeasured. */
export const SELF_STILL_BLOCKS = 2;
/** The distance within which a falling distance is an approach. Unmeasured. */
export const NEAR_BLOCKS = 32;

type Pos = [number, number, number];
type Sample = NonNullable<OtherModel['last_sample']>;

function blocksBetween(a: Pos, b: Pos): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * The position observations from one sighting, given the previous sample of that other. Returns the new sample to
 * store (null when the sighting has no distance, position or life id) and at most one observation.
 */
export function positionObservations(
  prev: OtherModel['last_sample'],
  tick: number,
  me: [number, number, number] | null,
  other: SocialSighting,
  observer: string,
): { observations: SocialObservation[]; sample: Sample | null } {
  const observations: SocialObservation[] = [];
  const life = other.life;
  const position = other.position;
  if (me === null || typeof other.distance !== 'number' || !Array.isArray(position)) {
    return { observations, sample: null };
  }
  if (life === undefined) return { observations, sample: null };
  const them: Pos = [position[0], position[1], position[2]];
  const sample: Sample = { tick, dist: other.distance, me: [...me], them };
  if (prev === undefined || tick - prev.tick < MIN_GAP_TICKS) return { observations, sample };
  if (blocksBetween(me, prev.me) > SELF_STILL_BLOCKS) return { observations, sample };
  if (prev.them === undefined || blocksBetween(them, prev.them) < MOVE_BLOCKS) {
    return { observations, sample };
  }
  let kind: ObsKind | null = null;
  if (other.distance < prev.dist && other.distance <= NEAR_BLOCKS) kind = 'approached';
  else if (other.distance > prev.dist) kind = 'kept_away';
  if (kind !== null) {
    observations.push({
      observer,
      kind,
      actor: life,
      actorName: cleanName(other.name),
      key: `pos:${life}:${Math.floor(tick / SAMPLE_TICKS)}`,
      tick,
    });
  }
  return { observations, sample };
}
