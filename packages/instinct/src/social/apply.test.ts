import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyObservations, noteSample, noteSighting } from './apply.ts';
import { SEEN_KEEP, SeenSet } from './dedup.ts';
import { eventOf, freshStateDir, OBSERVER, OTHER, OWN_SHEET, obsOf } from './observe.fixtures.ts';
import { eventObservations } from './observe.ts';
import { SocialStore } from './store.ts';

const LIFE = 'life-1';

function open(root: string): { store: SocialStore; seen: SeenSet } {
  return { store: new SocialStore(root, OBSERVER, LIFE), seen: new SeenSet(root) };
}

/** Every file under a folder, as text. */
function allText(root: string): string {
  let text = '';
  for (const name of readdirSync(root, { recursive: true }) as string[]) {
    const file = join(root, name);
    if (statSync(file).isFile()) text += readFileSync(file, 'utf8');
  }
  return text;
}

describe('dedup and scope', () => {
  it('the same hurt delivered twice counts once, also across a restart', () => {
    const root = freshStateDir();
    const a = open(root);
    const o = obsOf();
    const first = applyObservations(a.store, a.seen, OWN_SHEET, OBSERVER, [o, o], 1);
    expect(first.applied).toBe(1);
    expect(first.deduped).toBe(1);
    expect(a.store.load(OTHER)?.fields.aggression?.n).toBe(1);

    const b = open(root);
    const again = applyObservations(b.store, b.seen, OWN_SHEET, OBSERVER, [o], 2);
    expect(again.deduped).toBe(1);
    expect(again.applied).toBe(0);
    expect(b.store.load(OTHER)?.fields.aggression?.n).toBe(1);
  });

  it('an observation whose observer differs is dropped as foreign', () => {
    const root = freshStateDir();
    const { store, seen } = open(root);
    const r = applyObservations(
      store,
      seen,
      OWN_SHEET,
      OBSERVER,
      [obsOf({ observer: 'nobody' })],
      1,
    );
    expect(r.dropped.foreign).toBe(1);
    expect(r.applied).toBe(0);
    expect(store.load(OTHER)).toBeNull();
  });

  it('the observer own act is dropped as self; fight_seen is dropped as inactive', () => {
    const root = freshStateDir();
    const { store, seen } = open(root);
    const self = obsOf({ actor: OBSERVER });
    const fight = obsOf({ kind: 'fought_mob', key: 'fight:f1' });
    const r = applyObservations(store, seen, OWN_SHEET, OBSERVER, [self, fight], 1);
    expect(r.dropped.self).toBe(1);
    expect(r.dropped.inactive).toBe(1);
    expect(r.applied).toBe(0);
  });

  it('an actor id that is not safe counts in badId and touches no model', () => {
    const root = freshStateDir();
    const { store, seen } = open(root);
    const r = applyObservations(store, seen, OWN_SHEET, OBSERVER, [obsOf({ actor: 'bad id!' })], 1);
    expect(r.dropped.badId).toBe(1);
    expect(allText(root)).not.toContain('bad id!');
  });
});

describe('model updates', () => {
  it('took_mine updates law and good once each', () => {
    const root = freshStateDir();
    const { store, seen } = open(root);
    const took = obsOf({ kind: 'took_mine', key: 'break:b1' });
    applyObservations(store, seen, OWN_SHEET, OBSERVER, [took], 1);
    expect(store.load(OTHER)?.fields.law?.n).toBe(1);
    expect(store.load(OTHER)?.fields.good?.n).toBe(1);
    applyObservations(store, seen, OWN_SHEET, OBSERVER, [took], 2);
    expect(store.load(OTHER)?.fields.law?.n).toBe(1);
    expect(store.load(OTHER)?.fields.good?.n).toBe(1);
  });

  it('an out-of-order batch gives the same models as the sorted batch', () => {
    const early = obsOf({ kind: 'spoke_first', key: 'speech:s1', tick: 100 });
    const late = obsOf({ kind: 'approached', key: 'pos:x:0', tick: 200 });
    const sorted = open(freshStateDir());
    applyObservations(sorted.store, sorted.seen, OWN_SHEET, OBSERVER, [early, late], 1);
    const shuffled = open(freshStateDir());
    applyObservations(shuffled.store, shuffled.seen, OWN_SHEET, OBSERVER, [late, early], 1);
    expect(shuffled.store.load(OTHER)).toEqual(sorted.store.load(OTHER));
  });

  it('the seen set keeps the newest 4000 keys, FIFO, also after a restart', () => {
    const root = freshStateDir();
    const seen = new SeenSet(root);
    for (let i = 0; i <= SEEN_KEEP; i++) seen.add(`k${i}`);
    expect(seen.has('k0')).toBe(false);
    expect(seen.has('k1')).toBe(true);
    expect(seen.has(`k${SEEN_KEEP}`)).toBe(true);
    seen.flush();
    const reloaded = new SeenSet(root);
    expect(reloaded.has('k0')).toBe(false);
    expect(reloaded.has(`k${SEEN_KEEP}`)).toBe(true);
  });

  it('a sample and a sighting are stored on the model of a known other', () => {
    const root = freshStateDir();
    const { store, seen } = open(root);
    noteSample(store, OBSERVER, OTHER, 'Other Name', 1, {
      tick: 5,
      dist: 9,
      me: [0, 0, 0],
      them: [9, 0, 0],
    });
    expect(store.load(OTHER)?.last_sample?.dist).toBe(9);
    applyObservations(store, seen, OWN_SHEET, OBSERVER, [obsOf()], 1);
    noteSighting(store, OTHER, 'Renamed "Other"', 3);
    expect(store.load(OTHER)?.sightings).toBe(1);
    expect(store.load(OTHER)?.last_run).toBe(3);
  });

  it('noteSighting ignores an unsafe id without throwing', () => {
    const { store } = open(freshStateDir());
    expect(() => noteSighting(store, 'bad id!', 'x', 1)).not.toThrow();
  });
});

describe('batch reports and leaks', () => {
  it('ApplyReport holds counts only, and actorName never equals the life id', () => {
    const root = freshStateDir();
    const { store, seen } = open(root);
    const obs = eventObservations(OBSERVER, [eventOf({ actorName: 'Other Name' })], []);
    expect(obs[0]?.actorName).not.toBe(obs[0]?.actor);
    const r = applyObservations(store, seen, OWN_SHEET, OBSERVER, obs, 1);
    expect(Object.keys(r).sort()).toEqual(['applied', 'deduped', 'dropped']);
    expect(Object.values(r.dropped).every((n) => typeof n === 'number')).toBe(true);
    expect(store.load(OTHER)?.name).toBe('Other Name');
  });

  it('an event object with an extra sheet field leaves no trace in the store folder', () => {
    const root = freshStateDir();
    const { store, seen } = open(root);
    const sentinel = 'SENTINEL_SHEET_9f3a';
    const event = { ...eventOf(), sheet: { alignment: { law: sentinel } } };
    const obs = eventObservations(OBSERVER, [event], []);
    applyObservations(store, seen, OWN_SHEET, OBSERVER, obs, 1);
    expect(allText(root)).not.toContain(sentinel);
  });
});
