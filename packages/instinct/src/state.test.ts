import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyState, loadState, SEEN_MAX, saveState, TRIED_MAX } from './state.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'instinct-state-'));
});

describe('state', () => {
  it('a missing file is the empty state', () => {
    expect(loadState(join(dir, 'absent'))).toEqual(emptyState());
  });

  it('survives a restart: save then load returns the same state', () => {
    const state = { ...emptyState(), waking: 7, attempts: { 'k:1': 2 }, cursor: 'c-9' };
    saveState(dir, state);
    expect(loadState(dir)).toEqual(state);
    expect(existsSync(join(dir, 'state.json.new'))).toBe(false);
  });

  it('a corrupt state.json is renamed state.json.bad and an empty state is used', () => {
    writeFileSync(join(dir, 'state.json'), '{not json');
    expect(loadState(dir)).toEqual(emptyState());
    expect(existsSync(join(dir, 'state.json.bad'))).toBe(true);
    expect(existsSync(join(dir, 'state.json'))).toBe(false);
  });

  it('a file with the wrong shape is corrupt too', () => {
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ v: 1, waking: 'many' }));
    expect(loadState(dir)).toEqual(emptyState());
    expect(existsSync(join(dir, 'state.json.bad'))).toBe(true);
  });

  it('bounds seen to the newest 500 and tried to 8 per key on save', () => {
    const seen = Array.from({ length: SEEN_MAX + 20 }, (_, i) => `k:${i}`);
    const tried = { 'p:1': Array.from({ length: TRIED_MAX + 3 }, (_, i) => `h${i}`) };
    saveState(dir, { ...emptyState(), seen, tried });
    const back = loadState(dir);
    expect(back.seen).toHaveLength(SEEN_MAX);
    expect(back.seen[0]).toBe('k:20');
    expect(back.tried['p:1']).toHaveLength(TRIED_MAX);
  });

  it('creates a missing directory', () => {
    const nested = join(dir, 'instinct');
    saveState(nested, emptyState());
    expect(readFileSync(join(nested, 'state.json'), 'utf8')).toContain('"v":1');
  });

  it.skipIf(process.platform === 'win32')('writes the state file 0600', () => {
    const nested = join(dir, 'instinct');
    saveState(nested, emptyState());
    expect(statSync(join(nested, 'state.json')).mode & 0o777).toBe(0o600);
  });

  it('a habits entry of the wrong shape is corrupt (renamed .bad)', () => {
    const bad = { ...emptyState(), habits: { 'k:1': [{ program: 7, arguments: {}, n: 1 }] } };
    writeFileSync(join(dir, 'state.json'), JSON.stringify(bad));
    expect(loadState(dir)).toEqual(emptyState());
    expect(existsSync(join(dir, 'state.json.bad'))).toBe(true);
  });

  it('attempts that are not integer counts are corrupt (renamed .bad)', () => {
    writeFileSync(
      join(dir, 'state.json'),
      JSON.stringify({ ...emptyState(), attempts: { 'k:1': 'two' } }),
    );
    expect(loadState(dir)).toEqual(emptyState());
    expect(existsSync(join(dir, 'state.json.bad'))).toBe(true);
  });

  it('tried lists that are not strings are corrupt (renamed .bad)', () => {
    writeFileSync(
      join(dir, 'state.json'),
      JSON.stringify({ ...emptyState(), tried: { 'p:1': [1, 2] } }),
    );
    expect(loadState(dir)).toEqual(emptyState());
    expect(existsSync(join(dir, 'state.json.bad'))).toBe(true);
  });

  it('a version other than 1 is corrupt (renamed .bad)', () => {
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...emptyState(), v: 2 }));
    expect(loadState(dir)).toEqual(emptyState());
    expect(existsSync(join(dir, 'state.json.bad'))).toBe(true);
  });
});
