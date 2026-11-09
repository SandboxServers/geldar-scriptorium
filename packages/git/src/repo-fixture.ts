import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gitEnv } from './run-git.ts';

// Test support only: runs any git command with the null global config.
export function git(root: string, args: readonly string[], env?: NodeJS.ProcessEnv): string {
  const result = spawnSync('git', [...args], {
    cwd: root,
    env: env ? { ...gitEnv(), ...env } : gitEnv(),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

export function makeRepo(
  files: Record<string, string>,
  playerId = 'mmpr-red',
): { root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'geldar-git-repo-'));
  const all = { ...files, 'player.json': `${JSON.stringify({ player_id: playerId })}\n` };
  for (const [rel, content] of Object.entries(all)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['add', '-A']);
  git(root, [
    '-c',
    'user.name=Host',
    '-c',
    'user.email=host@example.test',
    'commit',
    '-q',
    '-m',
    'start',
  ]);
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
