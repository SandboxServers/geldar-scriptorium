import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { readRoster } from './roster.ts';

let stateDir: string;
beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'roster-'));
});

function writeRoster(text: string): void {
  writeFileSync(join(stateDir, 'roster.json'), text);
}

describe('readRoster (HC-46b)', () => {
  it('readRoster: a missing file, an oversize file, a bad id and a bad name each give an empty map or drop the entry', () => {
    // A missing file.
    expect(readRoster(stateDir).size).toBe(0);

    // An oversize file (over 16 KiB) is ignored whole.
    writeRoster(JSON.stringify({ Ann: 'life_ann', pad: 'x'.repeat(17 * 1024) }));
    expect(readRoster(stateDir).size).toBe(0);

    // A bad id is dropped; the other entry stays.
    writeRoster(JSON.stringify({ Ann: 'life ann', Bob: 'life_bob' }));
    expect([...readRoster(stateDir)]).toEqual([['Bob', 'life_bob']]);

    // A bad name is dropped: empty, too long, or with a control character.
    writeRoster(
      JSON.stringify({
        '': 'life_a',
        ['n'.repeat(41)]: 'life_b',
        'Bad\nName': 'life_c',
        Cy: 'life_cy',
      }),
    );
    expect([...readRoster(stateDir)]).toEqual([['Cy', 'life_cy']]);
  });

  it('readRoster: a directory named roster.json, or a JSON array, gives an empty map', () => {
    mkdirSync(join(stateDir, 'roster.json'));
    expect(readRoster(stateDir).size).toBe(0);
    const arrayDir = mkdtempSync(join(tmpdir(), 'roster-'));
    writeFileSync(join(arrayDir, 'roster.json'), '[["Ann","life_ann"]]');
    expect(readRoster(arrayDir).size).toBe(0);
  });

  it('readRoster: a file that is not JSON gives an empty map and does not throw', () => {
    writeRoster('{ not json');
    expect(readRoster(stateDir).size).toBe(0);
  });

  it('a valid roster maps a name to its id', () => {
    writeRoster(JSON.stringify({ Ann: 'life_ann', Bob: 'life-bob-2' }));
    const roster = readRoster(stateDir);
    expect(roster.get('Ann')).toBe('life_ann');
    expect(roster.get('Bob')).toBe('life-bob-2');
    expect(roster.size).toBe(2);
  });

  it('two names mapped to one id are both kept', () => {
    writeRoster(JSON.stringify({ Ann: 'life_ann', Anne: 'life_ann' }));
    expect(readRoster(stateDir).size).toBe(2);
  });

  it('a name of exactly 40 characters is kept', () => {
    writeRoster(JSON.stringify({ ['n'.repeat(40)]: 'life_ok' }));
    expect(readRoster(stateDir).size).toBe(1);
  });

  it('no roster file is the inactive case: an empty map', () => {
    expect(readRoster(join(stateDir, 'absent')).size).toBe(0);
  });
});
