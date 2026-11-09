import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './check.ts';

// The skills this packet ships. Later packets add their own names here.
const skillNames = ['play', 'reflect'];

interface Skill {
  frontmatter: Record<string, string>;
  body: string;
}

// Splits a SKILL.md into its frontmatter (simple `key: value` lines between
// two `---` fences) and its body. Throws when the fences are missing.
function parseSkill(text: string): Skill {
  const lines = text.split('\n');
  if (lines[0] !== '---') throw new Error('frontmatter must open with ---');
  const close = lines.indexOf('---', 1);
  if (close === -1) throw new Error('frontmatter must close with ---');
  const frontmatter: Record<string, string> = {};
  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(':');
    if (at === -1) throw new Error(`bad frontmatter line: ${line}`);
    frontmatter[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { frontmatter, body: lines.slice(close + 1).join('\n') };
}

function readSkill(name: string): string {
  return readFileSync(path.join(repoRoot, 'template/.claude/skills', name, 'SKILL.md'), 'utf8');
}

describe.each(skillNames)('skill %s', (name) => {
  const skill = parseSkill(readSkill(name));

  it('has frontmatter that parses', () => {
    expect(skill.frontmatter.name).toBeDefined();
    expect(skill.frontmatter.description).toBeDefined();
  });

  it('names the skill after its folder', () => {
    expect(skill.frontmatter.name).toBe(name);
  });

  it('has a description', () => {
    expect((skill.frontmatter.description ?? '').length).toBeGreaterThan(0);
  });

  it('keeps the body under 80 lines', () => {
    expect(skill.body.split('\n').length).toBeLessThan(80);
  });
});

describe('play skill', () => {
  const body = parseSkill(readSkill('play')).body;

  it('uses the wait cursor and the 240 second window', () => {
    expect(body).toContain('cursor');
    expect(body).toContain('240');
  });

  it('never gives through a separate give tool', () => {
    expect(body).not.toContain('give(');
  });
});
