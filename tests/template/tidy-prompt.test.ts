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
      '# Journal',
      'commit_memory',
      'tidy: ',
    ]) {
      expect(TIDY_PROMPT).toContain(part);
    }
  });
});
