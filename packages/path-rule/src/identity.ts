export interface GitIdentity {
  name: string;
  email: string;
}

const PLAYER_ID = /^[a-z][a-z0-9-]{1,38}$/;

export function isValidPlayerId(id: string): boolean {
  return typeof id === 'string' && PLAYER_ID.test(id);
}

export function noreplyIdentity(playerId: string): GitIdentity {
  if (!isValidPlayerId(playerId)) throw new Error('invalid player id');
  return {
    name: `player-${playerId}`,
    email: `player-${playerId}@users.noreply.github.com`,
  };
}
