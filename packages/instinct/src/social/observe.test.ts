import { describe, expect, it } from 'vitest';
import { eventOf, OBSERVER, OTHER, sightingOf } from './observe.fixtures.ts';
import { cleanName, eventObservations, isControl, NAME_MAX } from './observe.ts';
import {
  MIN_GAP_TICKS,
  MOVE_BLOCKS,
  NEAR_BLOCKS,
  positionObservations,
  SAMPLE_TICKS,
} from './sample.ts';

describe('event table and actor ids', () => {
  it('maps a hurt with a life id to hit_me under the hurt key, scoped to the observer', () => {
    const out = eventObservations(OBSERVER, [eventOf()], []);
    expect(out).toEqual([
      {
        observer: OBSERVER,
        kind: 'hit_me',
        actor: OTHER,
        actorName: 'Other Name',
        key: 'hurt:e1',
        tick: 100,
      },
    ]);
  });

  it('maps each event kind to its observation kind and key tag', () => {
    const events = [
      eventOf({ kind: 'speech_to_me', id: 's' }),
      eventOf({ kind: 'gift_received', id: 'g' }),
      eventOf({ kind: 'property_broken', id: 'b' }),
      eventOf({ kind: 'fight_seen', id: 'f' }),
    ];
    const out = eventObservations(OBSERVER, events, []);
    expect(out.map((o) => [o.kind, o.key])).toEqual([
      ['spoke_first', 'speech:s'],
      ['gave_me', 'gift:g'],
      ['took_mine', 'break:b'],
      ['fought_mob', 'fight:f'],
    ]);
  });

  it('gives nothing for container_taken, which waits for HC-27c', () => {
    expect(eventObservations(OBSERVER, [eventOf({ kind: 'container_taken' })], [])).toEqual([]);
  });

  it('an event without an actor gives nothing', () => {
    const bare = eventOf({ actorName: undefined, actorLife: undefined });
    expect(eventObservations(OBSERVER, [bare], [sightingOf()])).toEqual([]);
  });

  it('an event without a non-empty id gives nothing', () => {
    expect(eventObservations(OBSERVER, [eventOf({ id: '' })], [])).toEqual([]);
  });

  it('a name is resolved to the one nearby life with that exact name', () => {
    const events = [eventOf({ actorLife: undefined, actorName: 'Other Name' })];
    const out = eventObservations(OBSERVER, events, [sightingOf()]);
    expect(out).toHaveLength(1);
    expect(out[0]?.actor).toBe(OTHER);
  });

  it('an ambiguous name is dropped', () => {
    const events = [eventOf({ actorLife: undefined, actorName: 'Other Name' })];
    const nearby = [sightingOf({ life: 'life-a' }), sightingOf({ life: 'life-b' })];
    expect(eventObservations(OBSERVER, events, nearby)).toEqual([]);
  });

  it('a name with no life and no actorLife is dropped and never stored as an id', () => {
    const events = [eventOf({ actorLife: undefined, actorName: 'Other Name' })];
    const nearby = [sightingOf({ life: undefined })];
    const out = eventObservations(OBSERVER, events, nearby);
    expect(out).toEqual([]);
    expect(out.some((o) => o.actor === 'Other Name')).toBe(false);
  });

  it('a hostile name is cleaned before it is kept as a display name', () => {
    const hostile = `  "Bob\u0007\n<b>${'x'.repeat(60)}"  `;
    const out = eventObservations(OBSERVER, [eventOf({ actorName: hostile })], []);
    expect(out[0]?.actorName).toBe(cleanName(hostile));
    expect(out[0]?.actorName).not.toContain('"');
    expect(Array.from(out[0]?.actorName ?? '').some(isControl)).toBe(false);
    expect(out[0]?.actorName.length).toBeLessThanOrEqual(NAME_MAX);
  });

  it('cleanName strips control characters and quotes and collapses spaces', () => {
    expect(cleanName('  a\u0001  "b"\t c  ')).toBe('a b c');
  });
});

describe('position sampling', () => {
  const me: [number, number, number] = [0, 0, 0];
  const far: [number, number, number] = [40, 0, 0];

  it('a sighting without a position gives nothing', () => {
    const r = positionObservations(
      undefined,
      100,
      me,
      sightingOf({ position: undefined }),
      OBSERVER,
    );
    expect(r).toEqual({ observations: [], sample: null });
  });

  it('a first sample gives no observation and is stored', () => {
    const r = positionObservations(undefined, 100, me, sightingOf({ position: far }), OBSERVER);
    expect(r.observations).toEqual([]);
    expect(r.sample).toEqual({ tick: 100, dist: 10, me, them: far });
  });

  it('a standing other, moved under MOVE_BLOCKS, gives nothing', () => {
    const prev = { tick: 0, dist: 20, me, them: [10, 0, 0] as [number, number, number] };
    const now = sightingOf({ distance: 10, position: [10 + MOVE_BLOCKS - 1, 0, 0] });
    const r = positionObservations(prev, MIN_GAP_TICKS, me, now, OBSERVER);
    expect(r.observations).toEqual([]);
    expect(r.sample).not.toBeNull();
  });

  it('an other closing in within NEAR_BLOCKS gives approached, under its life id', () => {
    const prev = { tick: 0, dist: 20, me, them: [30, 0, 0] as [number, number, number] };
    const now = sightingOf({ distance: 10, position: [20, 0, 0] });
    const r = positionObservations(prev, 200, me, now, OBSERVER);
    expect(r.observations).toEqual([
      {
        observer: OBSERVER,
        kind: 'approached',
        actor: OTHER,
        actorName: 'Other Name',
        key: `pos:${OTHER}:${Math.floor(200 / SAMPLE_TICKS)}`,
        tick: 200,
      },
    ]);
  });

  it('an other drawing away gives kept_away', () => {
    const prev = { tick: 0, dist: 10, me, them: [10, 0, 0] as [number, number, number] };
    const now = sightingOf({ distance: 20, position: [20, 0, 0] });
    const r = positionObservations(prev, 200, me, now, OBSERVER);
    expect(r.observations.map((o) => o.kind)).toEqual(['kept_away']);
  });

  it('an approach beyond NEAR_BLOCKS gives nothing', () => {
    const prev = { tick: 0, dist: 90, me, them: [90, 0, 0] as [number, number, number] };
    const now = sightingOf({ distance: NEAR_BLOCKS + 1, position: [NEAR_BLOCKS + 1, 0, 0] });
    const r = positionObservations(prev, 200, me, now, OBSERVER);
    expect(r.observations).toEqual([]);
  });

  it('own movement above SELF_STILL_BLOCKS gives nothing (the observer moved)', () => {
    const prev = { tick: 0, dist: 20, me, them: [30, 0, 0] as [number, number, number] };
    const moved: [number, number, number] = [3, 0, 0];
    const now = sightingOf({ distance: 10, position: [20, 0, 0] });
    const r = positionObservations(prev, 200, moved, now, OBSERVER);
    expect(r.observations).toEqual([]);
    expect(r.sample).toEqual({ tick: 200, dist: 10, me: moved, them: [20, 0, 0] });
  });

  it('a gap under MIN_GAP_TICKS gives nothing but a new sample', () => {
    const prev = { tick: 0, dist: 20, me, them: [30, 0, 0] as [number, number, number] };
    const now = sightingOf({ distance: 10, position: [20, 0, 0] });
    const r = positionObservations(prev, MIN_GAP_TICKS - 1, me, now, OBSERVER);
    expect(r.observations).toEqual([]);
    expect(r.sample?.tick).toBe(MIN_GAP_TICKS - 1);
  });

  it('a sighting without a life id gives no observation and no sample', () => {
    const r = positionObservations(
      undefined,
      1,
      me,
      sightingOf({ life: undefined, position: far }),
      OBSERVER,
    );
    expect(r).toEqual({ observations: [], sample: null });
  });
});
