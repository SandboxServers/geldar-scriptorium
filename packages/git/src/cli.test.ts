import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { git, makeRepo } from './repo-fixture.ts';

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function run(args: string[], env: Record<string, string | undefined> = {}) {
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base.GELDAR_MODE;
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: resolve('.'),
    env: { ...base, ...env },
    encoding: 'utf8',
    timeout: 30000,
  });
}

function fixture() {
  const repo = makeRepo({ 'CLAUDE.md': 'rules\n', 'memory/summary.md': 'one\n' });
  cleanups.push(repo.cleanup);
  return repo.root;
}

describe('geldar-git commit', () => {
  it('with --if-changed and no changes exits 0 and prints nothing', () => {
    const root = fixture();
    const result = run(['commit', '--root', root, '--message', 'm', '--if-changed']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('without --if-changed and no changes exits 1', () => {
    const root = fixture();
    const result = run(['commit', '--root', root, '--message', 'm']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('nothing_to_commit');
  });

  it('with a change exits 0, prints the saved line, and makes a commit', () => {
    const root = fixture();
    writeFileSync(join(root, 'memory/summary.md'), 'two\n');
    const result = run(['commit', '--root', root, '--message', 'm', '--if-changed']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^saved [0-9a-f]{7}: 1 file\(s\)\n$/);
    expect(git(root, ['rev-list', '--count', 'HEAD']).trim()).toBe('2');
  }, 30000);

  it('refuses a bad GELDAR_MODE with bad_session_mode', () => {
    const root = fixture();
    const result = run(['commit', '--root', root, '--message', 'm'], { GELDAR_MODE: 'x' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('bad_session_mode');
  }, 30000);

  it('exits 2 with no subcommand', () => {
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  }, 30000);
});
