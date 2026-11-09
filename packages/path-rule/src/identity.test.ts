import { describe, expect, it } from 'vitest';
import { isValidPlayerId, noreplyIdentity } from './identity.ts';

describe('noreplyIdentity', () => {
  it('builds the fixed noreply identity from the player id', () => {
    expect(noreplyIdentity('mmpr-red')).toEqual({
      name: 'player-mmpr-red',
      email: 'player-mmpr-red@users.noreply.github.com',
    });
  });

  it('accepts the shortest and longest valid ids', () => {
    expect(isValidPlayerId('ab')).toBe(true);
    expect(isValidPlayerId(`a${'b'.repeat(38)}`)).toBe(true);
    expect(noreplyIdentity('ab').name).toBe('player-ab');
  });

  it.each(['', 'a', 'A', 'Mmpr', '1abc', '-abc', 'a_b', 'a b', 'a@b', 'x'.repeat(40)])(
    'rejects %j',
    (id) => {
      expect(isValidPlayerId(id)).toBe(false);
      expect(() => noreplyIdentity(id)).toThrow('invalid player id');
    },
  );
});
