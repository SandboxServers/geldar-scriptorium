import type { RollRecord as PsycheRollRecord } from '@geldar/scriptorium-psyche';
import { describe, expect, it } from 'vitest';
import {
  type InstinctResult,
  parseInstinctResult,
  type RollRecord,
  sanitizeFact,
} from './contract.ts';

const roll: RollRecord = {
  id: 'abc:3:idle:0',
  fx: 'idle',
  score: 3,
  dc: 11,
  mode: 'flat',
  dice: [12],
  kept: 12,
  bonus: 0,
  total: 12,
  success: true,
};
const settle = {
  v: 1,
  kind: 'settle',
  fx: 'idle',
  why: 'habit for the top goal',
  act: { tool: 'act', arguments: { program: 'walk' } },
  rolls: [roll],
  world: { accepted: true, line: 'Your intent was accepted.' },
};
const text = (value: unknown): string => JSON.stringify(value);

describe('contract', () => {
  it('parses a well formed settle, pass-with-facts and pass', () => {
    expect(parseInstinctResult(text(settle))).toEqual(settle);
    const withFacts = {
      v: 1,
      kind: 'pass-with-facts',
      fx: 'none',
      facts: ['You have not seen Ann before.'],
      rolls: [],
    };
    expect(parseInstinctResult(text(withFacts))).toEqual(withFacts);
    const pass = { v: 1, kind: 'pass', reason: 'dead', forced: false, rolls: [] };
    expect(parseInstinctResult(text(pass))).toEqual(pass);
  });

  it('rejects a settle without world.accepted === true', () => {
    expect(
      parseInstinctResult(text({ ...settle, world: { accepted: false, line: 'x' } })),
    ).toBeNull();
    expect(parseInstinctResult(text({ ...settle, world: { line: 'x' } }))).toBeNull();
  });

  it('rejects unknown kinds, unknown keys and a missing key', () => {
    expect(parseInstinctResult(text({ ...settle, kind: 'act' }))).toBeNull();
    expect(parseInstinctResult(text({ ...settle, extra: 1 }))).toBeNull();
    const { why: _why, ...noWhy } = settle;
    expect(parseInstinctResult(text(noWhy))).toBeNull();
  });

  it('rejects more than 4 facts, a fact over 200 characters and a non-printable fact', () => {
    const base = { v: 1, kind: 'pass-with-facts', fx: 'none', rolls: [] };
    expect(parseInstinctResult(text({ ...base, facts: ['a', 'b', 'c', 'd', 'e'] }))).toBeNull();
    expect(parseInstinctResult(text({ ...base, facts: ['x'.repeat(201)] }))).toBeNull();
    expect(parseInstinctResult(text({ ...base, facts: ['bad\u0007'] }))).toBeNull();
    expect(parseInstinctResult(text({ ...base, facts: ['x'.repeat(200)] }))).not.toBeNull();
  });

  it('requires forced to match the forced reasons', () => {
    expect(
      parseInstinctResult(
        text({ v: 1, kind: 'pass', reason: 'first_sighting', forced: false, rolls: [] }),
      ),
    ).toBeNull();
    expect(
      parseInstinctResult(text({ v: 1, kind: 'pass', reason: 'dead', forced: true, rolls: [] })),
    ).toBeNull();
  });

  it('rejects text over 65536 bytes and anything that is not JSON', () => {
    expect(parseInstinctResult('{')).toBeNull();
    expect(parseInstinctResult(`${' '.repeat(65536)}${text(settle)}`)).toBeNull();
  });

  it('sanitizeFact keeps printable ASCII, turns quotes into single quotes and caps the length', () => {
    expect(sanitizeFact('say "hi"é\n', 50)).toBe("say 'hi'");
    expect(sanitizeFact('abcdef', 3)).toBe('abc');
  });

  it('RollRecord is the same shape as the engine kit copy (both ways)', () => {
    const fromPsyche: PsycheRollRecord = roll;
    const back: RollRecord = fromPsyche;
    const result: InstinctResult = {
      v: 1,
      kind: 'pass-with-facts',
      fx: 'none',
      facts: [],
      rolls: [back],
    };
    expect(parseInstinctResult(text(result))).toEqual(result);
  });
});
