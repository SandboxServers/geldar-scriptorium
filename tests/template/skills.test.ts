import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './check.ts';

const skillsDir = path.join(repoRoot, 'template/.claude/skills');
const names = ['trade', 'author', 'moot'];

// Splits a SKILL.md into its frontmatter fields and its body.
function readSkill(name: string) {
  const text = readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (match === null) throw new Error(`${name}: frontmatter does not parse`);
  const [, front = '', body = ''] = match;
  const fields = new Map<string, string>();
  for (const line of front.split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return { fields, body: body.trimEnd() };
}

describe.each(names)('template skill %s', (name) => {
  it('has frontmatter whose name is the folder name and a description', () => {
    const { fields } = readSkill(name);
    expect(fields.get('name')).toBe(name);
    expect(fields.get('description')?.length ?? 0).toBeGreaterThan(0);
  });

  it('has a body under 50 lines', () => {
    expect(readSkill(name).body.split('\n').length).toBeLessThan(50);
  });
});

describe('author skill', () => {
  it('says learned copies are never run', () => {
    expect(readSkill('author').body).toMatch(/copies are never run/i);
  });
});
