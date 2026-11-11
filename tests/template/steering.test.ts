import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkInstructions, repoRoot } from './instructions.ts';

// The character's own text (geldar decision 0014, dispatch rule 7). Nothing here may name
// the repo, its packets, CI or how the kit is built.
const templateDir = path.join(repoRoot, 'template');
const instructionFiles = ['CLAUDE.md', 'AGENTS.md'].map((f) => path.join(templateDir, f));
const playSkill = path.join(templateDir, '.claude/skills/play/SKILL.md');
const allTemplateText = [...instructionFiles, playSkill].map((f) => ({
  file: path.relative(repoRoot, f),
  text: readFileSync(f, 'utf8'),
}));

const forbiddenWords = ['poll', 'launcher', 'packet', 'CI', 'kit', 'repo'];

describe('steering text', () => {
  it('CLAUDE.md and AGENTS.md teach intents, waiting and sleep', () => {
    for (const file of instructionFiles) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).toContain('intent');
      expect(text, file).toContain('wake');
      expect(text, file).toContain('wait');
      expect(text, file).toContain('To pass time, wait or sleep.');
    }
  });

  it('the play skill puts an intent and a wake condition in step 4 and says waiting is free', () => {
    const text = readFileSync(playSkill, 'utf8');
    const step4 = text.split('\n').find((line) => line.startsWith('4. ')) ?? '';
    expect(step4).toContain('intent');
    expect(step4).toContain('wake');
    expect(text).toContain('Waiting is free');
  });

  it('none of the steering files names the repo, its tooling or the kit (whole words)', () => {
    for (const { file, text } of allTemplateText) {
      for (const word of forbiddenWords) {
        const pattern = new RegExp(`\\b${word}\\b`, 'i');
        expect(pattern.test(text), `${file} contains "${word}"`).toBe(false);
      }
    }
  });

  it('the planner opens play with an initialPrompt that names the play skill, and the skill exists', () => {
    const agent = readFileSync(path.join(templateDir, '.claude/agents/planner.md'), 'utf8');
    const line = agent.split('\n').find((l) => l.startsWith('initialPrompt:')) ?? '';
    expect(line).toMatch(/\bplay skill\b/);
    expect(line.length).toBeLessThanOrEqual(200 + 'initialPrompt: '.length);
    expect(existsSync(playSkill)).toBe(true);
  });

  it('the generated instruction files still match their source', () => {
    expect(checkInstructions(templateDir)).toEqual([]);
  });
});
