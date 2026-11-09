import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Mode } from '@geldar/scriptorium-path-rule';
import { isValidPlayerId } from '@geldar/scriptorium-path-rule';

export interface VerifyInput {
  bundle: string;
  start: string;
  branch: string;
  mode: Mode;
  playerId: string;
}

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/;

function validBranch(branch: string): boolean {
  return (
    BRANCH.test(branch) &&
    !branch.includes('..') &&
    !branch.endsWith('/') &&
    !branch.endsWith('.lock')
  );
}

// null means bad_arguments: a missing, unknown, repeated or malformed option.
export function parseVerifyArgs(argv: readonly string[]): VerifyInput | null {
  const seen = new Set<string>();
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    if (seen.has(token)) return null;
    seen.add(token);
  }
  try {
    const { values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        bundle: { type: 'string' },
        start: { type: 'string' },
        branch: { type: 'string' },
        mode: { type: 'string' },
        'player-id': { type: 'string' },
      },
    });
    const { bundle, start, branch, mode, 'player-id': playerId } = values;
    if (bundle === undefined || start === undefined || branch === undefined) return null;
    if (mode === undefined || playerId === undefined) return null;
    if (!SHA.test(start) || !validBranch(branch)) return null;
    if (mode !== 'play' && mode !== 'setup') return null;
    if (!isValidPlayerId(playerId)) return null;
    return { bundle: resolve(bundle), start, branch, mode, playerId };
  } catch {
    return null;
  }
}
