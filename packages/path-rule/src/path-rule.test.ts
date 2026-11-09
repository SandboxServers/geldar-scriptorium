import { describe, expect, it } from 'vitest';
import { identityLocked, isAllowedPath, type Mode } from './path-rule.ts';

// skills/ then 60-character components joined with '/', then a last component
// ending in '.md', so the whole string is exactly n characters.
function longPath(n: number): string {
  const prefix = 'skills/';
  let rest = n - prefix.length;
  let out = prefix;
  while (rest > 64) {
    out += `${'a'.repeat(60)}/`;
    rest -= 61;
  }
  out += `${'a'.repeat(rest - 3)}.md`;
  if (out.length !== n) throw new Error(`longPath(${n}) built ${out.length}`);
  if (out.split('/').some((part) => part.length > 64)) throw new Error('component too long');
  return out;
}

const rows: [string, Mode, boolean][] = [
  // allowed
  ['memory/summary.md', 'play', true],
  ['memory/summary.md', 'setup', true],
  ['memory/goals.md', 'play', true],
  ['memory/beliefs.md', 'play', true],
  ['memory/people/pike.md', 'play', true],
  ['memory/people/.gitkeep', 'play', true],
  ['memory/people/.gitkeep', 'setup', true],
  ['memory/journal/current.md', 'play', true],
  ['memory/journal/day-007.md', 'play', true],
  ['memory/a.b.md', 'play', true],
  ['skills/farm.js', 'play', true],
  ['skills/farm.json', 'setup', true],
  ['skills/notes/farm-v2.md', 'play', true],
  // names that only look reserved
  ['skills/console.js', 'play', true],
  ['skills/com10.md', 'play', true],
  ['skills/conf.md', 'play', true],
  // identity: write-once
  ['memory/identity.md', 'play', false],
  ['memory/identity.md', 'setup', true],
  ['memory/Identity.md', 'play', false],
  ['memory/Identity.md', 'setup', false],
  ['memory/IDENTITY.md', 'play', false],
  // outside the two trees
  ['CLAUDE.md', 'play', false],
  ['CLAUDE.md', 'setup', false],
  ['AGENTS.md', 'play', false],
  ['player.json', 'play', false],
  ['.mcp.json', 'play', false],
  ['.claude/settings.json', 'play', false],
  ['template/memory/a.md', 'play', false],
  ['Memory/a.md', 'play', false],
  ['MEMORY/a.md', 'play', false],
  // dot components
  ['memory/.gitattributes', 'play', false],
  ['memory/people/.gitattributes', 'play', false],
  ['skills/.gitmodules', 'play', false],
  ['memory/.hidden/a.md', 'play', false],
  ['memory/people/.x.md', 'play', false],
  ['memory/.gitkeep', 'play', false],
  ['memory/journal/.gitkeep', 'play', false],
  ['skills/.gitkeep', 'play', false],
  // traversal and shape
  ['memory/../CLAUDE.md', 'play', false],
  ['memory/people/../../CLAUDE.md', 'play', false],
  ['memory/./a.md', 'play', false],
  ['memory//a.md', 'play', false],
  ['/memory/a.md', 'play', false],
  ['memory\\a.md', 'play', false],
  ['memory/a.md/', 'play', false],
  ['memory', 'play', false],
  ['memory/', 'play', false],
  ['skills', 'play', false],
  ['', 'play', false],
  // extensions
  ['memory/a.txt', 'play', false],
  ['memory/a.sh', 'play', false],
  ['memory/a.MD', 'play', false],
  ['memory/a', 'play', false],
  ['memory/a.md.exe', 'play', false],
  // Windows names
  ['skills/CON.md', 'play', false],
  ['skills/con.md', 'play', false],
  ['skills/NUL.json', 'play', false],
  ['skills/aux.d/x.md', 'play', false],
  ['memory/COM1.md', 'play', false],
  ['skills/LPT9.js', 'play', false],
  ['memory/people/con.md', 'play', false],
  ['skills/com0.md', 'play', false],
  ['skills/LPT0.md', 'play', false],
  ['memory/a./b.md', 'play', false],
  ['memory/a.md::$DATA', 'play', false],
  ['memory/a b.md', 'play', false],
  ['memory/a.md ', 'play', false],
  // control and non-ASCII characters
  ['memory/a\n.md', 'play', false],
  ['memory/é.md', 'play', false],
  // length caps (a component is the whole name with its extension)
  [`skills/${'a'.repeat(61)}.md`, 'play', true],
  [`skills/${'a'.repeat(62)}.md`, 'play', false],
  ['memory/Identity.md/x.md', 'play', false],
  ['memory/Identity.md/x.md', 'setup', false],
  ['memory/identity.md/x.md', 'setup', false],
  ['MEMORY/IDENTITY.MD/a.md', 'play', false],
  [longPath(200), 'play', true],
  [longPath(201), 'play', false],
];

describe('isAllowedPath', () => {
  it.each(rows)('%s in %s mode -> %s', (path, mode, allowed) => {
    expect(isAllowedPath(path, mode)).toBe(allowed);
  });

  it('rejects an unknown mode', () => {
    expect(isAllowedPath('memory/a.md', 'other' as Mode)).toBe(false);
  });
});

describe('identityLocked', () => {
  it('locks identity in play and not in setup', () => {
    expect(identityLocked('play')).toBe(true);
    expect(identityLocked('setup')).toBe(false);
  });
});
