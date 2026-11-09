import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVerifyArgs } from './args.ts';

const SHA = 'a'.repeat(40);

function valid(overrides: Record<string, string> = {}): string[] {
  const options: Record<string, string> = {
    '--bundle': 'session.bundle',
    '--start': SHA,
    '--branch': 'main',
    '--mode': 'play',
    '--player-id': 'mmpr-red',
    ...overrides,
  };
  return Object.entries(options).flat();
}

describe('parseVerifyArgs', () => {
  it('parses a valid set and resolves the bundle path', () => {
    expect(parseVerifyArgs(valid())).toEqual({
      bundle: resolve('session.bundle'),
      start: SHA,
      branch: 'main',
      mode: 'play',
      playerId: 'mmpr-red',
    });
  });

  it('returns null when a required option is missing', () => {
    const argv = valid();
    const at = argv.indexOf('--player-id');
    expect(parseVerifyArgs(argv.filter((_, i) => i !== at && i !== at + 1))).toBeNull();
  });

  it('returns null for each bad value', () => {
    expect(parseVerifyArgs(valid({ '--mode': 'other' }))).toBeNull();
    expect(parseVerifyArgs(valid({ '--start': 'abc' }))).toBeNull();
    expect(parseVerifyArgs(valid({ '--branch': '../x' }))).toBeNull();
    expect(parseVerifyArgs(valid({ '--branch': 'a..b' }))).toBeNull();
    expect(parseVerifyArgs(valid({ '--branch': 'x.lock' }))).toBeNull();
    expect(parseVerifyArgs(valid({ '--player-id': 'A' }))).toBeNull();
  });

  it('returns null for an unknown option', () => {
    expect(parseVerifyArgs([...valid(), '--force', 'yes'])).toBeNull();
  });

  it('returns null when an option is repeated', () => {
    expect(parseVerifyArgs([...valid(), '--mode', 'setup'])).toBeNull();
  });
});
