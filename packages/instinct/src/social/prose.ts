// The bounded social prose (HC-29): the lines that name what this life has learned of a nearby other, for the prompt.
// The wording is owner-approved (2026-11-28, relayed verbatim through geldar-69 and geldar-sheet). The decision 0324
// position and id wording is still open and is not here. The template scan runs on every sentence.
import { MAX_FACT_CHARS, sanitizeFact } from '../contract.ts';
import type { LearnedField } from './rules.ts';

export const BANK: Readonly<Record<LearnedField, { high: string; low: string }>> = {
  curiosity: {
    high: 'Often goes to new places and things.',
    low: 'Seldom goes to new places and things.',
  },
  aggression: {
    high: 'Often attacks others.',
    low: 'Seldom attacks others.',
  },
  law: {
    high: 'Often keeps agreements.',
    low: 'Often breaks agreements.',
  },
  good: {
    high: 'Often helps others.',
    low: 'Often harms others.',
  },
};

export const UNSURE = 'This may be wrong.';

// The display name is shown quoted and cleaned, and capped so the uncertainty note always fits on the line.
const MAX_NAME_CHARS = 32;

/**
 * One line: About 'NAME': <bank sentence> <UNSURE>. The name is cleaned, then every single quote is removed, so the
 * two quotes around the name are the only quotes in the line. A line over MAX_FACT_CHARS is a bank error and throws,
 * so UNSURE is never cut.
 */
export function renderLine(name: string, f: LearnedField, dir: 'high' | 'low'): string {
  const shown = sanitizeFact(name, MAX_NAME_CHARS).replace(/'/g, '').trim() || 'unnamed';
  const line = `About '${shown}': ${BANK[f][dir]} ${UNSURE}`;
  if (line.length > MAX_FACT_CHARS) {
    throw new Error('social prose line over MAX_FACT_CHARS: shorten the bank sentence');
  }
  return line;
}
