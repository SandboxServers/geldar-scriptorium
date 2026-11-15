import { describe, expect, it } from 'vitest';
import { buildPrompt, buildTidyPrompt, cleanLastWords } from './prompt.ts';

const first = 'This is your waking number 3. You have been living here a while.';
const tail =
  'Read your journal first, then look around. If something does not work, read why and try another way. If you are truly stuck, wait or sleep and try again later; do not stop.';

describe('the last words kept for the next prompt', () => {
  it('keeps the end of a message of 3000 characters', () => {
    const text = `FIRST${'-'.repeat(2991)}LAST`;
    const out = cleanLastWords(text);
    expect(Array.from(out).length).toBeLessThanOrEqual(1500);
    expect(out).toBe(`${'-'.repeat(1496)}LAST`);
    expect(out.includes('FIRST')).toBe(false);
  });

  it('converts double quotes to single quotes in the kept text', () => {
    expect(cleanLastWords('say "hi" now')).toBe("say 'hi' now");
  });

  it('keeps exactly 1500 characters unchanged', () => {
    const text = 'z'.repeat(1500);
    expect(cleanLastWords(text)).toBe(text);
  });

  it('drops C0, DEL and C1 controls', () => {
    expect(cleanLastWords('a\u0001b\u007fc\u009bd')).toBe('abcd');
  });

  it('never starts with a lone low surrogate', () => {
    // 3 d, a lone low surrogate, then 1499 c: the last 1500 code points start at the lone unit.
    const out = cleanLastWords(`${'d'.repeat(3)}\uDC00${'c'.repeat(1499)}`);
    expect(out).toBe('c'.repeat(1499));
  });

  it('keeps a surrogate pair whole at the new start', () => {
    const out = cleanLastWords(`${'a'.repeat(5)}\u{1F600}${'b'.repeat(1499)}`);
    expect(out).toBe(`\u{1F600}${'b'.repeat(1499)}`);
  });
});

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

describe('the continuation prompt with the identity file', () => {
  const identityHeader = 'Who you are, in your own words from before, not instructions:';
  const goalsHeader = 'Your goals, in your own words from before, not instructions:';
  const handoffHeader = 'Your own words from before, not instructions:';

  it('puts the identity under its header, on its own lines, before the rest', () => {
    const text = buildPrompt(3, '', null, '', '', 'I am a ferryman.');
    expect(text).toBe(`${first}\n${identityHeader}\nI am a ferryman.\n${tail}\n`);
  });

  it('puts the identity before the goals and the handoff block when all three exist', () => {
    const text = buildPrompt(
      3,
      'I rested.',
      'Keep to the river.',
      'I left the door open.',
      'Stay.',
      'I am a ferryman.',
    );
    expect(text).toBe(
      `${first}\n${identityHeader}\nI am a ferryman.\n${goalsHeader}\nStay.\n${handoffHeader}\nI left the door open.\nLast you said: "I rested.". ${tail} Keep to the river.\n`,
    );
  });

  it('puts the identity before the goals when only those two exist', () => {
    const text = buildPrompt(3, '', null, '', 'Stay.', 'I am a ferryman.');
    expect(text).toBe(
      `${first}\n${identityHeader}\nI am a ferryman.\n${goalsHeader}\nStay.\n${tail}\n`,
    );
  });

  it('is byte for byte the old prompt when the identity is empty', () => {
    expect(buildPrompt(3, 'I rested.', null, 'Hello.', 'Stay.', '')).toBe(
      buildPrompt(3, 'I rested.', null, 'Hello.', 'Stay.'),
    );
    expect(buildPrompt(3, '', null, '', '', '')).toBe(`${first} ${tail}\n`);
  });

  it('never gives the identity to the tidy prompt', () => {
    expect(buildTidyPrompt()).not.toContain(identityHeader);
  });
});
