import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hardenedEnv, safeDirectoryConfig } from './git.ts';

describe('the safe-directory config the keeper uses to read the player workspace', () => {
  it('names every directory it is given, so git reads a repository the player user owns', () => {
    const file = safeDirectoryConfig(['/workspace', '/workspace/.git']);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('[safe]');
    expect(text).toContain('directory = /workspace\n');
    expect(text).toContain('directory = /workspace/.git\n');
  });

  it('is private to the keeper', () => {
    const file = safeDirectoryConfig(['/workspace']);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o077).toBe(0);
  });

  it('reaches git through GIT_CONFIG_GLOBAL (a -c setting is not inherited by upload-pack)', () => {
    const file = safeDirectoryConfig(['/workspace']);
    const env = hardenedEnv({ GIT_CONFIG_GLOBAL: file });
    expect(env.GIT_CONFIG_GLOBAL).toBe(file);
    // Everything else stays locked down.
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });
});
