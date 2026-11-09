import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { noreplyIdentity } from '@geldar/scriptorium-path-rule';
import { afterEach, describe, expect, it } from 'vitest';
import { GitError, gitEnv, gitOptions, runGit } from './run-git.ts';

const restore: (() => void)[] = [];
const cleanups: (() => void)[] = [];

function setEnv(key: string, value: string | undefined): void {
  const before = process.env[key];
  restore.push(() => {
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
  });
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err instanceof GitError ? err.code : 'other';
  }
}

afterEach(() => {
  for (const undo of restore.splice(0).reverse()) undo();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('runGit allowlist', () => {
  const refused: string[][] = [
    ['push'],
    ['fetch'],
    ['remote', '-v'],
    ['config', '--list'],
    ['add', '-A'],
    ['status'],
    ['reset'],
    ['commit', '-m', 'x'],
    ['hash-object', 'x'],
    ['hash-object', '--no-filters', 'x'],
    ['hash-object', '--no-filters', '--stdin-paths', '--path=x'],
    ['diff'],
  ];

  for (const args of refused) {
    it(`refuses ${args.join(' ')}`, () => {
      expect(codeOf(() => runGit('/nonexistent-root', args))).toBe('git_subcommand_not_allowed');
    });
  }
});

describe('runGit source scan', () => {
  it('no non-test source names a forbidden subcommand', () => {
    const srcDir = fileURLToPath(new URL('.', import.meta.url));
    const sources = readdirSync(srcDir).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThan(0);
    const forbidden = /['"`](push|fetch|remote|pull)['"`]/;
    for (const name of sources) {
      const text = readFileSync(join(srcDir, name), 'utf8');
      expect(forbidden.test(text), name).toBe(false);
    }
  });
});

describe('identity layers', () => {
  it('gitEnv sets the noreply identity and drops GIT_DIR', () => {
    setEnv('GIT_AUTHOR_EMAIL', 'env@example.test');
    setEnv('GIT_COMMITTER_EMAIL', 'env@example.test');
    setEnv('GIT_DIR', join(tmpdir(), 'some-other-repo'));
    const identity = noreplyIdentity('mmpr-red');
    const env = gitEnv(identity);
    expect(env.GIT_AUTHOR_NAME).toBe('player-mmpr-red');
    expect(env.GIT_AUTHOR_EMAIL).toBe('player-mmpr-red@users.noreply.github.com');
    expect(env.GIT_COMMITTER_NAME).toBe('player-mmpr-red');
    expect(env.GIT_COMMITTER_EMAIL).toBe('player-mmpr-red@users.noreply.github.com');
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_ATTR_NOSYSTEM).toBe('1');
  });

  it('gitOptions disables replace objects first, and a host value cannot unset it', () => {
    setEnv('GIT_NO_REPLACE_OBJECTS', '0');
    expect(gitOptions()).toContain('--no-replace-objects');
    expect(gitOptions()[0]).toBe('--no-replace-objects');
    expect(gitEnv().GIT_NO_REPLACE_OBJECTS).toBe('1');
  });

  it('gitOptions adds the user options only with an identity', () => {
    const options = gitOptions(noreplyIdentity('mmpr-red'));
    expect(options).toContain('user.name=player-mmpr-red');
    expect(options).toContain('user.email=player-mmpr-red@users.noreply.github.com');
    expect(gitOptions().some((option) => option.startsWith('user.'))).toBe(false);
  });
});

describe('global config', () => {
  it('git ignores the host global config', () => {
    const home = mkdtempSync(join(tmpdir(), 'geldar-git-host-'));
    cleanups.push(() => rmSync(home, { recursive: true, force: true }));
    mkdirSync(join(home, '.config', 'git'), { recursive: true });
    const config = '[user]\n\temail = host@example.test\n';
    writeFileSync(join(home, '.gitconfig'), config);
    writeFileSync(join(home, '.config', 'git', 'config'), config);
    setEnv('HOME', home);
    setEnv('USERPROFILE', home);
    setEnv('XDG_CONFIG_HOME', home);
    const result = spawnSync('git', ['config', 'user.email'], {
      cwd: home,
      env: gitEnv(),
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  });
});
