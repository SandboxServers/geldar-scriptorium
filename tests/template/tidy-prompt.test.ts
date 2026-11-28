import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TIDY_PROMPT } from '../../packages/supervisor/src/prompt.ts';
import { forbiddenMention, markedWords } from './tool-skill-scan.ts';

// SC-171: the memory tidy text is player-facing, so it passes the same scan as the template's texts.
describe('the memory tidy prompt', () => {
  it('has no marker word the agent-text scan rejects', () => {
    expect(markedWords(TIDY_PROMPT)).toEqual([]);
  });

  it('never mentions the harness, the budget, models, prompts, sessions or Glass', () => {
    expect(TIDY_PROMPT.match(forbiddenMention)).toBeNull();
  });

  it('is plain ASCII and names every step of the tidy', () => {
    expect(TIDY_PROMPT).toMatch(/^[\x20-\x7e\n]+$/);
    for (const part of [
      'day-NNN.md',
      'beliefs.md',
      'people/',
      'goals.md',
      'summary.md',
      'memory/journal/pending.md',
      'Edit with an empty old_string',
      'commit_memory',
      'tidy: ',
    ]) {
      expect(TIDY_PROMPT).toContain(part);
    }
  });

  // SC-186: the tidy keeps places, people, debts and open promises.
  it('asks to keep places, debts and open promises, and sets the 100-line limit', () => {
    for (const part of [
      'what you owe them and what they owe you',
      'Keep every promise and debt that is still open',
      'the newer one is true',
      'under 100 lines',
      'with its coordinates exactly as the journal gives them',
      'what you owe and to whom',
    ]) {
      expect(TIDY_PROMPT).toContain(part);
    }
    expect(TIDY_PROMPT).not.toContain('under 60 lines');
  });

  it('the reflect skill keeps the same summary size as the tidy prompt (SC-187)', () => {
    const reflect = readFileSync(
      new URL('../../template/.claude/skills/reflect/SKILL.md', import.meta.url),
      'utf8',
    );
    expect(reflect).toContain('so it fits on one page, under 100 lines');
    expect(reflect).not.toContain('60 lines');
  });
});
