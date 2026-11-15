// The kit's reader against the rules of the card and against the engine's own normalizer. The conformance test
// is the drift guard: for every text in the corpus, parseSheet is non-null exactly when normalizeSheet accepts
// the parsed JSON.
import { describe, expect, it } from 'vitest';
import { normalizeSheet, STANDARD_SHEET } from '../engine/index.ts';
import { MAX_SHEET_BYTES, parseSheet, type Sheet } from './sheet.ts';

type Plain = Record<string, unknown>;

const SCORE_PATHS: readonly [string, string][] = [
  ['attributes', 'curiosity'],
  ['attributes', 'common_sense'],
  ['attributes', 'cleverness'],
  ['attributes', 'aggression'],
  ['alignment', 'law'],
  ['alignment', 'good'],
  ['op_modes', 'explorer'],
  ['op_modes', 'farmer'],
  ['op_modes', 'miner'],
  ['op_modes', 'builder'],
  ['op_modes', 'crafter'],
  ['op_modes', 'warrior'],
  ['op_modes', 'nitwit'],
];

/** A fresh sheet object: every score 3, the standard sheet as JSON would carry it. */
function base(): Plain {
  return {
    version: 1,
    attributes: { curiosity: 3, common_sense: 3, cleverness: 3, aggression: 3 },
    alignment: { law: 3, good: 3 },
    op_modes: { explorer: 3, farmer: 3, miner: 3, builder: 3, crafter: 3, warrior: 3, nitwit: 3 },
  };
}

function setScore(path: readonly [string, string], value: unknown): Plain {
  const sheet = base();
  (sheet[path[0]] as Plain)[path[1]] = value;
  return sheet;
}

const VARIED: Sheet = {
  version: 1,
  attributes: { curiosity: 5, common_sense: 1, cleverness: 4, aggression: 2 },
  alignment: { law: 1, good: 5 },
  op_modes: {
    explorer: 5,
    farmer: 1,
    miner: 2,
    builder: 4,
    crafter: 3,
    warrior: 5,
    nitwit: 1,
  },
};

/** Texts the reader must answer exactly as the engine's normalizer does. Every one is under MAX_SHEET_BYTES. */
function corpus(): string[] {
  const texts: string[] = [JSON.stringify(base()), JSON.stringify(VARIED)];
  // Every score at both ends of its range, on every path: valid.
  for (const path of SCORE_PATHS) {
    texts.push(JSON.stringify(setScore(path, 1)), JSON.stringify(setScore(path, 5)));
  }
  // Every score path with each kind of invalid value: out of range, non-integer, wrong type.
  const badValues: unknown[] = [0, 6, -1, 3.5, 2.000001, '3', null, true, [3], {}];
  for (const path of SCORE_PATHS) {
    for (const value of badValues) texts.push(JSON.stringify(setScore(path, value)));
  }
  // A missing score key on each path.
  for (const path of SCORE_PATHS) {
    const sheet = base();
    delete (sheet[path[0]] as Plain)[path[1]];
    texts.push(JSON.stringify(sheet));
  }
  // Unknown keys at every level, the proficiency key included.
  const withTop = (key: string, value: unknown): Plain => ({ ...base(), [key]: value });
  texts.push(JSON.stringify(withTop('extra', 1)), JSON.stringify(withTop('proficiency', {})));
  texts.push(JSON.stringify(withTop('proficiency', { curiosity: 0 })));
  for (const group of ['attributes', 'alignment', 'op_modes'] as const) {
    const sheet = base();
    (sheet[group] as Plain).extra = 3;
    texts.push(JSON.stringify(sheet));
  }
  // The version, the top-level shape and the groups' types.
  for (const version of [0, 2, '1', null, true, 1.5])
    texts.push(JSON.stringify({ ...base(), version }));
  const missingVersion = base();
  delete missingVersion.version;
  texts.push(JSON.stringify(missingVersion));
  for (const group of ['attributes', 'alignment', 'op_modes'] as const) {
    const sheet = base();
    delete sheet[group];
    texts.push(JSON.stringify(sheet));
    texts.push(JSON.stringify({ ...base(), [group]: [3, 3, 3, 3] }));
    texts.push(JSON.stringify({ ...base(), [group]: 3 }));
  }
  texts.push('[]', '3', '"text"', 'null', 'true', '{}', '');
  // Text that is not JSON, and JSON the normalizer would still have to read as the same shape.
  texts.push('{', 'not json', '{"version":1,}', JSON.stringify(base()).replace('{', '{ '));
  texts.push(`  ${JSON.stringify(base())}  \n`);
  texts.push(
    '{"version":1,"version":2,"attributes":{"curiosity":3,"common_sense":3,"cleverness":3,"aggression":3},"alignment":{"law":3,"good":3},"op_modes":{"explorer":3,"farmer":3,"miner":3,"builder":3,"crafter":3,"warrior":3,"nitwit":3}}',
  );
  texts.push(
    '{"__proto__":{"x":1},"version":1,"attributes":{"curiosity":3,"common_sense":3,"cleverness":3,"aggression":3},"alignment":{"law":3,"good":3},"op_modes":{"explorer":3,"farmer":3,"miner":3,"builder":3,"crafter":3,"warrior":3,"nitwit":3}}',
  );
  return texts;
}

/** The engine's verdict on a text: a text that does not parse is refused. */
function engineAccepts(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  return normalizeSheet(parsed).ok;
}

describe('parseSheet', () => {
  it('accepts the standard sheet and a varied sheet', () => {
    expect(parseSheet(JSON.stringify(STANDARD_SHEET))).toEqual(STANDARD_SHEET);
    expect(parseSheet(JSON.stringify(VARIED))).toEqual(VARIED);
  });

  it('rejects unknown keys, score 0, score 6, 3.5, a missing group, a 5 KB text', () => {
    expect(parseSheet(JSON.stringify({ ...base(), extra: 1 }))).toBeNull();
    expect(parseSheet(JSON.stringify(setScore(['attributes', 'curiosity'], 0)))).toBeNull();
    expect(parseSheet(JSON.stringify(setScore(['op_modes', 'nitwit'], 6)))).toBeNull();
    expect(parseSheet(JSON.stringify(setScore(['alignment', 'law'], 3.5)))).toBeNull();
    const noGroup = base();
    delete noGroup.op_modes;
    expect(parseSheet(JSON.stringify(noGroup))).toBeNull();
    const big = ` ${JSON.stringify(base())}`.padEnd(5 * 1024, ' ');
    expect(parseSheet(big)).toBeNull();
  });

  it('refuses a sheet that carries proficiency at the top or inside a group', () => {
    expect(parseSheet(JSON.stringify({ ...base(), proficiency: {} }))).toBeNull();
    const inside = base();
    (inside.attributes as Plain).proficiency = 1;
    expect(parseSheet(JSON.stringify(inside))).toBeNull();
  });

  it('reads texts up to MAX_SHEET_BYTES bytes and refuses one byte more', () => {
    const json = JSON.stringify(base());
    const at = ' '.repeat(MAX_SHEET_BYTES - json.length) + json;
    const over = ' '.repeat(MAX_SHEET_BYTES - json.length + 1) + json;
    expect(new TextEncoder().encode(at).byteLength).toBe(MAX_SHEET_BYTES);
    expect(parseSheet(at)).toEqual(STANDARD_SHEET);
    expect(parseSheet(over)).toBeNull();
  });

  it('never throws and returns no partial sheet for non-JSON or non-string input', () => {
    expect(parseSheet('{')).toBeNull();
    expect(parseSheet('')).toBeNull();
    expect(parseSheet(undefined as unknown as string)).toBeNull();
    expect(parseSheet(base() as unknown as string)).toBeNull();
  });

  it('agrees with the engine normalizer on every text of a 90 input corpus', () => {
    const texts = corpus();
    expect(texts.length).toBeGreaterThanOrEqual(90);
    for (const text of texts) {
      expect(parseSheet(text) !== null, text).toBe(engineAccepts(text));
    }
    const accepted = texts.filter(engineAccepts).length;
    expect(accepted).toBeGreaterThan(0);
    expect(texts.length - accepted).toBeGreaterThan(40);
  });
});
