import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The compose project name is the launcher's constant (read only): fleet scripts never build it
// themselves, and this test fails if the launcher changes it.
const repo = fileURLToPath(new URL('../..', import.meta.url));

describe('compose project name', () => {
  it('the launcher names the player compose project geldar-player-<id>', () => {
    const player = readFileSync(join(repo, 'launcher', 'lib', 'player.sh'), 'utf8');
    expect(player).toContain('compose -p "geldar-player-$id"');
  });
});
