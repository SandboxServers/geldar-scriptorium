// Social observations from the world's events, scoped to one observer (HC-27b). An observation names the other life by
// its supervisor-side id. A display name is only used to find that id in the nearby sightings; it is never stored as an
// id. Pure: nothing here reads or writes a file. Event text and names are untrusted: they are cleaned, never executed.
import type { ObsKind } from './rules.ts';

export type SocialEventKind =
  | 'speech_to_me'
  | 'hurt'
  | 'gift_received'
  | 'property_broken'
  | 'fight_seen'
  | 'container_taken';

/** One world event as the adapter reads it. Only these fields are read; any other field is ignored. */
export interface SocialEvent {
  kind: SocialEventKind;
  id: string;
  tick: number;
  actorName?: string;
  actorLife?: string;
}

/** One nearby other as the adapter reads it. A sighting has no position unless the world gives one. */
export interface SocialSighting {
  name: string;
  life?: string;
  distance: number | null;
  position?: [number, number, number] | null;
}

/** One observed act, scoped to the observer it was seen by. `actor` is the other's id, never its name. */
export interface SocialObservation {
  observer: string;
  kind: ObsKind;
  actor: string;
  actorName: string;
  key: string;
  tick: number;
}

/** The longest display name kept. */
export const NAME_MAX = 40;

const EVENT_KIND: Partial<Record<SocialEventKind, ObsKind>> = {
  speech_to_me: 'spoke_first',
  hurt: 'hit_me',
  gift_received: 'gave_me',
  property_broken: 'took_mine',
  fight_seen: 'fought_mob',
};

const EVENT_TAG: Partial<Record<SocialEventKind, string>> = {
  speech_to_me: 'speech',
  hurt: 'hurt',
  gift_received: 'gift',
  property_broken: 'break',
  fight_seen: 'fight',
};

/** A C0 control character or DEL. */
export function isControl(c: string): boolean {
  const code = c.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
}

/** Strips control characters and double quotes, collapses spaces and keeps at most NAME_MAX characters. */
export function cleanName(raw: string): string {
  const kept = Array.from(raw).filter((c) => !isControl(c));
  const stripped = kept.join('').replace(/"/g, '');
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  return Array.from(collapsed).slice(0, NAME_MAX).join('').trim();
}

/**
 * The id of an event's actor. The actor's life id when the event carries one; else the single nearby sighting with
 * exactly the event's actor name, and its life. No match, two matches or a match without a life gives null.
 */
function actorOf(event: SocialEvent, nearby: readonly SocialSighting[]): string | null {
  if (event.actorLife !== undefined) return event.actorLife;
  if (event.actorName === undefined) return null;
  const hits = nearby.filter((s) => s.name === event.actorName);
  if (hits.length !== 1) return null;
  return hits[0]?.life ?? null;
}

/**
 * The observations the events give. An event without an actor, a kind with no mapping (container_taken, HC-27c) or an
 * event without a non-empty id gives nothing. fight_seen is mapped and then dropped as inactive when applied.
 */
export function eventObservations(
  observer: string,
  events: readonly SocialEvent[],
  nearby: readonly SocialSighting[],
): SocialObservation[] {
  const out: SocialObservation[] = [];
  for (const event of events) {
    const kind = EVENT_KIND[event.kind];
    const tag = EVENT_TAG[event.kind];
    if (kind === undefined || tag === undefined) continue;
    if (typeof event.id !== 'string' || event.id === '') continue;
    const actor = actorOf(event, nearby);
    if (actor === null) continue;
    out.push({
      observer,
      kind,
      actor,
      actorName: cleanName(event.actorName ?? ''),
      key: `${tag}:${event.id}`,
      tick: event.tick,
    });
  }
  return out;
}
