import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './check.ts';

// The skills this packet ships. Later packets add their own names here.
const skillNames = ['play', 'reflect', 'setup'];

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

  it('tells the character once to use act with unstick when stuck, with no digit or jargon', () => {
    const lines = body.split('\n').filter((l) => l.includes('unstick'));
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? '';
    expect(line).toContain('`act`');
    expect(line).toContain('`unstick`');
    expect(line).not.toMatch(/\d/);
    expect(line).not.toMatch(/reflex|cooldown|geldar|PR\b/i);
  });

  it('never gives through a separate give tool', () => {
    expect(body).not.toContain('give(');
  });

  it('teaches the world fixed lines for results, hurt, sounds, body and death', () => {
    for (const line of [
      'Your dig failed: the way was blocked.',
      'You could not get there: the way was blocked.',
      'You lack the materials to craft that.',
      'An arrow hit you from behind.',
      'You are burning.',
      'You hear hissing close to the north.',
      'You hear thunder far off to the west.',
      'Health does not regenerate naturally while hunger is low. Hunger falls over time.',
      'You died. Something struck you down. You wake at the spawn with nothing.',
      'You dropped N items where you died.',
    ]) {
      expect(body).toContain(line);
    }
  });

  it('keeps the new reading sections free of meta words and digits', () => {
    const start = body.indexOf('## Reading your results');
    const end = body.indexOf('Budget:');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = body.slice(start, end);
    expect(section).not.toMatch(/\d/);
    expect(section).not.toMatch(
      /\b(outcomes?|events?|reflexes?|lives?|life's|respawns?|games?|counters?|budgets?|kit|tools? call|API|MCP|server)\b/i,
    );
  });

  it('never mentions dimensions, reach, register or a sound wake', () => {
    expect(body).not.toMatch(/dimension|\breach\b|register|sign-up|sound wake|wake interest/i);
    expect(body).not.toContain('you heard a sound');
  });

  it('keeps the recall and reach tools out of the new reading and waking sections', () => {
    const start = body.indexOf('## Reading your results');
    const section = body.slice(start);
    expect(section).not.toMatch(/recall|reach/i);
  });
});

describe('setup skill', () => {
  const skill = parseSkill(readSkill('setup'));

  it('is started only by the human', () => {
    expect(skill.frontmatter['disable-model-invocation']).toBe('true');
  });

  it('names all five identity headings', () => {
    for (const heading of ['Name', 'Traits', 'Voice', 'Seed', 'Values']) {
      expect(skill.body).toContain(heading);
    }
  });

  it('never mentions player.json', () => {
    expect(skill.body).not.toContain('player.json');
  });

  it('says the character may be fictional', () => {
    expect(skill.body).toContain('fictional');
  });
});

describe('reflect skill', () => {
  const body = parseSkill(readSkill('reflect')).body;

  it('writes the lesson of a death in the character voice, with no meta words', () => {
    expect(body).toContain(
      'If you died today, write first what killed you, what you dropped and where, and what it taught you.',
    );
    expect(body).not.toMatch(/\b(lives?|respawns?|games?|counters?|outcomes?|events?)\b/i);
    expect(body).not.toMatch(/dimension|\breach\b|register|sign-up|sound wake/i);
  });
});
