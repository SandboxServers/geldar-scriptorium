import { describe, expect, it } from 'vitest';
import { forbiddenMention, markedWords, readSkill, unquoted } from './tool-skill-scan.ts';

// BLD-25: the building skill teaches verbs and reading, never a push to build (decision 0426).
const nudge =
  /\b(should build|you must build|build more|keep building|goal|mission|quota|reward|xp|experience)\b/i;
const settings = JSON.parse(
  (await import('node:fs')).readFileSync('template/.claude/settings.json', 'utf8'),
) as { permissions: { allow: string[] } };

describe('building skill', () => {
  const skill = readSkill('building');

  it('has frontmatter named for the folder and a one-line description', () => {
    expect(skill.name).toBe('building');
    expect(skill.description).not.toContain('\n');
  });

  it('stays under 50 lines with no marker word, digit or forbidden mention', () => {
    expect(skill.body.split('\n').length).toBeLessThan(50);
    expect(markedWords(skill.text)).toEqual([]);
    expect(unquoted(skill.text)).not.toMatch(/\d/);
    expect(skill.text.match(forbiddenMention)).toBeNull();
  });

  it('names the verbs and the two read tools', () => {
    for (const word of ['break', 'plan', 'survey', 'plan_check', 'missing_materials', 'changed']) {
      expect(skill.text).toContain(word);
    }
  });

  it('explains the survey age mark, the inherited mark and the unseen-cell report', () => {
    expect(skill.text).toContain('@<min>');
    expect(skill.text).toContain('trailing `i`');
    expect(skill.text).toContain('cell not as expected');
  });

  it('has no nudge words', () => {
    expect(skill.text.match(nudge)).toBeNull();
  });

  it('is allowed with both new tools in the kit settings', () => {
    for (const line of ['Skill(building)', 'mcp__geldar__survey', 'mcp__geldar__plan_check']) {
      expect(settings.permissions.allow).toContain(line);
    }
  });
});
