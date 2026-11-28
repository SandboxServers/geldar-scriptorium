import { describe, expect, it } from 'vitest';
import { BANK, UNSURE } from '../../packages/instinct/src/social/prose.ts';
import { forbiddenMention, markedWords } from './tool-skill-scan.ts';

// The social prose sentences (HC-29) are read by the agent, so they pass the same scan as the skills.
// The wording is owner-approved; this scan keeps it inside the rules.
const bannedWord =
  /\b(lawful|chaotic|neutral|evil|alignment|score|stat|level|trait|estimate|watch|monitor|observ)\w*/i;

const sentences: string[] = [
  ...Object.values(BANK).flatMap((pair) => [pair.high, pair.low]),
  UNSURE,
];

describe('social prose sentences', () => {
  it('there are 8 bank sentences and one UNSURE', () => {
    expect(Object.keys(BANK)).toHaveLength(4);
    expect(sentences).toHaveLength(9);
  });

  it.each(sentences)('passes the scan: %s', (s) => {
    expect(markedWords(s)).toEqual([]);
    expect(!forbiddenMention.test(s)).toBe(true);
    expect(bannedWord.test(s)).toBe(false);
  });

  it.each(sentences)('is plain ASCII with no digit: %s', (s) => {
    expect(/^[\x20-\x7e]+$/.test(s)).toBe(true);
    expect(/\d/.test(s)).toBe(false);
  });
});
