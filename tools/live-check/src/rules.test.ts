import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizePath, parseDenyRules, pathMatchesRule } from './rules.ts';

const managed = readFileSync(
  fileURLToPath(new URL('../../../image/settings/managed.json', import.meta.url)),
  'utf8',
);

describe('parseDenyRules', () => {
  it('converts the real managed.json to exact tools and paths lists', () => {
    expect(parseDenyRules(managed)).toEqual({
      tools: ['Bash', 'WebFetch', 'WebSearch'],
      paths: [
        { tool: 'Read', pattern: '**/.credentials.json' },
        { tool: 'Edit', pattern: '**/.credentials.json' },
        { tool: 'Read', pattern: '//cli-home/**' },
        { tool: 'Edit', pattern: '//cli-home/**' },
        { tool: 'Read', pattern: '//cli-home' },
        { tool: 'Edit', pattern: '//cli-home' },
      ],
    });
  });

  it('refuses a file without a deny list', () => {
    expect(() => parseDenyRules('{}')).toThrow();
  });
});

describe('pathMatchesRule', () => {
  const home = { tool: 'Read', pattern: '//cli-home/**' } as const;
  it('matches absolute patterns at any depth', () => {
    expect(pathMatchesRule('/cli-home/a/b/c', home)).toBe(true);
    expect(pathMatchesRule('/cli-home', { tool: 'Read', pattern: '//cli-home' })).toBe(true);
  });
  it('normalises dot segments and repeated slashes', () => {
    expect(pathMatchesRule('/work/../cli-home//x/./y', home)).toBe(true);
    expect(normalizePath('/a/./b/../c//d')).toBe('/a/c/d');
  });
  it('is case-sensitive', () => {
    expect(pathMatchesRule('/CLI-HOME/x', home)).toBe(false);
  });
  it('matches the credentials file anywhere', () => {
    const cred = { tool: 'Read', pattern: '**/.credentials.json' } as const;
    expect(pathMatchesRule('/cli-home/.credentials.json', cred)).toBe(true);
    expect(pathMatchesRule('.credentials.json', cred)).toBe(true);
    expect(pathMatchesRule('/x/.credentials.json.bak', cred)).toBe(false);
  });
  it('single star stays within a segment', () => {
    expect(pathMatchesRule('/a/b/c', { tool: 'Read', pattern: '//a/*' })).toBe(false);
    expect(pathMatchesRule('/a/b', { tool: 'Read', pattern: '//a/*' })).toBe(true);
  });
});
