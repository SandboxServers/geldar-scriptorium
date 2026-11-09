import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git, gitEnv } from './run-git.ts';

const KEYS = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME'] as const;
const saved: Record<string, string | undefined> = {};
let cfg: string;
let plain: string;

beforeEach(() => {
  // A host config that would supply user.email if git read it.
  cfg = mkdtempSync(join(tmpdir(), 'verify-cfg-'));
  plain = join(cfg, 'plain');
  mkdirSync(join(cfg, '.config', 'git'), { recursive: true });
  mkdirSync(plain);
  const config = '[user]\n\temail = host@example.test\n';
  writeFileSync(join(cfg, '.gitconfig'), config);
  writeFileSync(join(cfg, '.config', 'git', 'config'), config);
  for (const key of KEYS) {
    saved[key] = process.env[key];
    process.env[key] = cfg;
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(cfg, { recursive: true, force: true });
});

describe('gitEnv', () => {
  it('keeps the host global config out of git', () => {
    const result = spawnSync('git', ['config', 'user.email'], {
      cwd: plain,
      env: gitEnv(),
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  });
});

describe('git', () => {
  it('returns a non-zero status without throwing', () => {
    const result = git(plain, ['rev-parse', '--verify', 'nope']);
    expect(result.status).not.toBe(0);
  });

  it('ignores replace objects, so a replaced commit reads as itself', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-replace-'));
    const env: NodeJS.ProcessEnv = {
      ...gitEnv(),
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.test',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.test',
    };
    const plainGit = (args: string[]) =>
      spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' });
    try {
      plainGit(['init', '-q']);
      plainGit(['commit', '-q', '--allow-empty', '-m', 'a']);
      const a = plainGit(['rev-parse', 'HEAD']).stdout.trim();
      plainGit(['commit', '-q', '--allow-empty', '-m', 'b']);
      const b = plainGit(['rev-parse', 'HEAD']).stdout.trim();
      plainGit(['replace', a, b]);
      expect(git(dir, ['log', '-1', '--format=%s', a]).stdout.trim()).toBe('a');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sets GIT_NO_REPLACE_OBJECTS in the environment', () => {
    expect(gitEnv().GIT_NO_REPLACE_OBJECTS).toBe('1');
  });
});
