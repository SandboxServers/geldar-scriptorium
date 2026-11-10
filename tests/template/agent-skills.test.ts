import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type AgentSkill, agentSkills, type SkillSource } from './agent-skills.ts';
import { repoRoot } from './check.ts';

const claudeSkillsDir = path.join(repoRoot, 'template/.claude/skills');

function readSources(): SkillSource[] {
  return readdirSync(claudeSkillsDir)
    .sort()
    .map((name) => ({
      name,
      text: readFileSync(path.join(claudeSkillsDir, name, 'SKILL.md'), 'utf8'),
    }));
}

// The body is everything after the closing fence, the same split the generator uses.
function bodyOf(text: string): string {
  const lines = text.split('\n');
  return lines.slice(lines.indexOf('---', 1) + 1).join('\n');
}

// The frontmatter keys in order, read from the output text.
function keysOf(text: string): string[] {
  const lines = text.split('\n');
  return lines
    .slice(1, lines.indexOf('---', 1))
    .map((line) => line.slice(0, line.indexOf(':')).trim());
}

const sources = readSources();
const generated = agentSkills(sources);
const names = (list: AgentSkill[]) => list.map((s) => s.name);

describe('agent skills from the template source', () => {
  it('is deterministic for the same sources in any order', () => {
    expect(agentSkills(sources)).toEqual(generated);
    expect(agentSkills([...sources].reverse())).toEqual(generated);
  });

  it('keeps each body byte for byte', () => {
    for (const skill of [...generated.skills, ...generated.setupOnly]) {
      const source = sources.find((s) => s.name === skill.name);
      expect(source).toBeDefined();
      expect(bodyOf(skill.text)).toBe(bodyOf(source?.text ?? ''));
    }
  });

  it('keeps exactly name and description in the frontmatter', () => {
    for (const skill of [...generated.skills, ...generated.setupOnly]) {
      expect(keysOf(skill.text)).toEqual(['name', 'description']);
      expect(skill.text).not.toContain('disable-model-invocation');
    }
  });

  it('puts the five play skills in the main list and setup only in setupOnly', () => {
    expect(names(generated.skills)).toEqual(['author', 'moot', 'play', 'reflect', 'trade']);
    expect(names(generated.setupOnly)).toEqual(['setup']);
    expect(names(generated.skills)).not.toContain('setup');
  });

  it('writes nothing under template/', () => {
    expect(existsSync(path.join(repoRoot, 'template/.agents'))).toBe(false);
  });
});

describe('agent skills rejects bad sources', () => {
  const good = '---\nname: play\ndescription: Play the game.\n---\nBody line.\n';

  it('throws when name is missing', () => {
    const bad = '---\ndescription: Play the game.\n---\nBody.\n';
    expect(() => agentSkills([{ name: 'play', text: bad }])).toThrow(/needs a name/);
  });

  it('throws when description is missing', () => {
    const bad = '---\nname: play\n---\nBody.\n';
    expect(() => agentSkills([{ name: 'play', text: bad }])).toThrow(/needs a description/);
  });

  it('throws when the frontmatter is not fenced', () => {
    expect(() => agentSkills([{ name: 'play', text: 'name: play\n' }])).toThrow(/open with ---/);
  });

  it('accepts a complete source', () => {
    expect(names(agentSkills([{ name: 'play', text: good }]).skills)).toEqual(['play']);
  });
});
