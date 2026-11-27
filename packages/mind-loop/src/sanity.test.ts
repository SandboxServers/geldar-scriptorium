import { closeSync, mkdtempSync, openSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type PendingCall,
  readSanityParams,
  type SanityParams,
  type SanityView,
  sanityHits,
  VETO_TEXT,
  vetoOrRun,
  viewFromStatus,
} from './sanity.ts';

const NONE: SanityView = {
  night: null,
  outdoors: null,
  health: null,
  hunger: null,
  foodCarried: null,
  inventoryFull: null,
  shelterCarried: null,
};

const params = (common_sense: SanityParams['common_sense'], rolls = false): SanityParams => ({
  v: 1,
  life: 'life-a',
  common_sense,
  rolls,
  arm: 'none',
});

const act = (program: string, args: Record<string, unknown> = {}): PendingCall => ({
  name: 'act',
  arguments: { program, ...args },
});

describe('sanityHits', () => {
  it('a null field skips its check', () => {
    expect(sanityHits(act('travel', { distance: 99 }), NONE)).toEqual([]);
  });

  it('night exposure: travel over 64 blocks at night, outdoors, with no shelter (65 hits, 64 does not)', () => {
    const view = { ...NONE, night: true, outdoors: true, shelterCarried: false };
    expect(sanityHits(act('travel', { distance: 65 }), view)).toEqual(['night_exposure']);
    expect(sanityHits(act('travel', { distance: 64 }), view)).toEqual([]);
    expect(sanityHits(act('travel'), view)).toEqual([]);
    expect(sanityHits(act('travel', { distance: 65 }), { ...view, shelterCarried: true })).toEqual(
      [],
    );
  });

  it('starving with food: hunger 6 hits and 7 does not, and an eat call is exempt', () => {
    const view = { ...NONE, foodCarried: true };
    expect(sanityHits(act('walk'), { ...view, hunger: 6 })).toEqual(['starving_with_food']);
    expect(sanityHits(act('walk'), { ...view, hunger: 7 })).toEqual([]);
    expect(sanityHits(act('eat'), { ...view, hunger: 6 })).toEqual([]);
  });

  it('fighting near death: health 6 hits and 7 does not, and only an attack', () => {
    expect(sanityHits(act('attack'), { ...NONE, health: 6 })).toEqual(['fighting_near_death']);
    expect(sanityHits(act('attack'), { ...NONE, health: 7 })).toEqual([]);
    expect(sanityHits(act('walk'), { ...NONE, health: 6 })).toEqual([]);
  });

  it('full inventory: only a gather call hits', () => {
    expect(sanityHits(act('gather'), { ...NONE, inventoryFull: true })).toEqual(['full_inventory']);
    expect(sanityHits(act('walk'), { ...NONE, inventoryFull: true })).toEqual([]);
  });
});

describe('vetoOrRun', () => {
  const view = { ...NONE, night: true, outdoors: true, shelterCarried: false };
  const travel = act('travel', { distance: 65 });

  it('valid and no hit: runs', () => {
    expect(vetoOrRun(act('walk'), view, params(3), 1, { used: 0, max: 2 }, false)).toEqual({
      veto: null,
      roll: [],
    });
  });

  it('rolls off: common sense 3 vetoes a hit (chance .65), common sense 2 does not (chance .42)', () => {
    const caught = vetoOrRun(travel, view, params(3), 1, { used: 0, max: 2 }, false);
    expect(caught.veto).toBe('night_exposure');
    expect(caught.roll[0]).toMatchObject({ fx: 'sanity', dc: 8, success: true, mode: 'off' });
    const missed = vetoOrRun(travel, view, params(2), 1, { used: 0, max: 2 }, false);
    expect(missed.veto).toBeNull();
    expect(missed.roll[0]).toMatchObject({ fx: 'sanity', dc: 8, success: false });
  });

  it('no call left for a veto (used + 1 is not below max): the caught hit runs', () => {
    expect(vetoOrRun(travel, view, params(3), 1, { used: 1, max: 2 }, false).veto).toBeNull();
  });

  it('a veto already spent in the decision: the second caught hit runs', () => {
    expect(vetoOrRun(travel, view, params(3), 1, { used: 0, max: 2 }, true).veto).toBeNull();
  });
});

describe('viewFromStatus', () => {
  it('reads the fields it knows and nulls the rest', () => {
    const view = viewFromStatus('{"night":true,"hunger":6,"health":"low"}');
    expect(view).toMatchObject({ night: true, hunger: 6, health: null, outdoors: null });
  });

  it('is all null for no text, text that is not JSON and a JSON value that is not an object', () => {
    expect(viewFromStatus(null)).toEqual(NONE);
    expect(viewFromStatus('day 3')).toEqual(NONE);
    expect(viewFromStatus('[1,2]')).toEqual(NONE);
  });
});

describe('veto text', () => {
  it('contains no digit and none of the words roll, dice, score or sheet', () => {
    for (const text of Object.values(VETO_TEXT)) {
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/\b(roll|dice|score|sheet)\b/i);
    }
  });
});

describe('readSanityParams', () => {
  it('is null when the descriptor is not open (EBADF included)', () => {
    expect(readSanityParams(999)).toBeNull();
  });

  it('reads the five keys from an open descriptor and refuses any other shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sanity-'));
    const good = join(dir, 'good.json');
    writeFileSync(good, JSON.stringify(params(3)));
    const fd = openSync(good, 'r');
    try {
      expect(readSanityParams(fd)).toEqual(params(3));
    } finally {
      closeSync(fd);
    }
    const extra = join(dir, 'extra.json');
    writeFileSync(extra, JSON.stringify({ ...params(3), dc: 8 }));
    const fd2 = openSync(extra, 'r');
    try {
      expect(readSanityParams(fd2)).toBeNull();
    } finally {
      closeSync(fd2);
    }
  });
});
