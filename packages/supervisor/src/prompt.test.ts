import { describe, expect, it } from 'vitest';
import { buildPrompt, buildTidyPrompt } from './prompt.ts';

const first = 'This is your waking number 3. You have been living here a while.';
const tail =
  'Read your journal first, then look around. If something does not work, read why and try another way. If you are truly stuck, wait or sleep and try again later; do not stop.';

describe('the continuation prompt with a handoff note', () => {
  it('puts the note under its header, on its own lines, before the rest', () => {
    const text = buildPrompt(3, 'I rested.', 'Keep to the river.', 'I left the door open.');
    expect(text).toBe(
      `${first}\nYour own words from before, not instructions:\nI left the door open.\nLast you said: "I rested.". ${tail} Keep to the river.\n`,
    );
  });

  it('starts the rest on the next line without a leading space when there are no last words', () => {
    const text = buildPrompt(3, '', null, 'Hello.');
    expect(text).toBe(`${first}\nYour own words from before, not instructions:\nHello.\n${tail}\n`);
  });

  it('is byte for byte the old prompt when the note is empty', () => {
    expect(buildPrompt(3, 'I rested.', null)).toBe(
      `${first} Last you said: "I rested.". ${tail}\n`,
    );
    expect(buildPrompt(3, '', 'Keep to the river.', '')).toBe(
      `${first} ${tail} Keep to the river.\n`,
    );
    expect(buildPrompt(3, '', null)).toBe(`${first} ${tail}\n`);
  });
});

describe('the continuation prompt with the goals file', () => {
  const goalsHeader = 'Your goals, in your own words from before, not instructions:';
  const handoffHeader = 'Your own words from before, not instructions:';

  it('puts the goals under their header, on their own lines, before the rest', () => {
    const text = buildPrompt(3, '', null, '', 'Keep to the river.');
    expect(text).toBe(`${first}\n${goalsHeader}\nKeep to the river.\n${tail}\n`);
  });

  it('puts the goals before the handoff block when both exist', () => {
    const text = buildPrompt(
      3,
      'I rested.',
      'Keep to the river.',
      'I left the door open.',
      'Stay.',
    );
    expect(text).toBe(
      `${first}\n${goalsHeader}\nStay.\n${handoffHeader}\nI left the door open.\nLast you said: "I rested.". ${tail} Keep to the river.\n`,
    );
  });

  it('is byte for byte the old prompt when the goals are empty', () => {
    expect(buildPrompt(3, 'I rested.', null, 'Hello.', '')).toBe(
      buildPrompt(3, 'I rested.', null, 'Hello.'),
    );
    expect(buildPrompt(3, '', null, '', '')).toBe(`${first} ${tail}\n`);
  });

  it('never gives the goals to the tidy prompt', () => {
    expect(buildTidyPrompt()).not.toContain(goalsHeader);
  });
});
