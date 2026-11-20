import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { OtherModel } from './model.ts';
import { SAFE_ID, SocialStore } from './store.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'social-store-'));
});

function modelFor(other: string): OtherModel {
  return {
    v: 1,
    observer: 'me',
    other,
    name: 'Other',
    sightings: 2,
    last_run: 3,
    spoke: true,
    fields: { curiosity: { estimate: 3.75, n: 1, tick: 5 } },
    updated_tick: 5,
  };
}

describe('social store', () => {
  it('round trip: save then load returns the same model, and a missing id is null', () => {
    const store = new SocialStore(root, 'me', 'life-1');
    const m = modelFor('x');
    store.save(m);
    expect(store.load('x')).toEqual(m);
    expect(store.load('absent')).toBeNull();
    expect(store.list()).toEqual([m]);
  });

  it.skipIf(process.platform === 'win32')('writes files mode 0600 and the directory 0700', () => {
    const store = new SocialStore(root, 'me', 'life-1');
    store.save(modelFor('x'));
    expect(statSync(join(root, 'social', 'other-x.json')).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, 'social')).mode & 0o777).toBe(0o700);
  });

  it('a different life archives the old directory and starts fresh', () => {
    new SocialStore(root, 'me', 'life-1').save(modelFor('x'));
    const next = new SocialStore(root, 'me', 'life-2');
    expect(next.load('x')).toBeNull();
    expect(next.list()).toEqual([]);
    expect(existsSync(join(root, 'social.archive-life-1', 'other-x.json'))).toBe(true);
  });

  it('unsafe ids are refused on load and on save; 39 characters is the longest safe id', () => {
    const store = new SocialStore(root, 'me', 'life-1');
    for (const id of ['../x', 'a b', 'a'.repeat(40)]) {
      expect(() => store.load(id)).toThrow();
      expect(() => store.save(modelFor(id))).toThrow();
    }
    expect(SAFE_ID.test('a'.repeat(39))).toBe(true);
  });
});
