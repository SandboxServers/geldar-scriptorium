// The bounded social prose (HC-29): the lines that name what this life has learned of a nearby other, for the prompt.
// THE WORDING BELOW IS A PLACEHOLDER. No sentence here is owner-approved; the owner's wording for BANK and UNSURE,
// and the decision 0324 position and id wording, are still open. Nothing in this file counts as approved text.
// The real bank replaces these strings in a follow-up card after approval, and the same template scan is re-run then.
import { MAX_FACT_CHARS, sanitizeFact } from '../contract.ts';
import type { LearnedField } from './rules.ts';

export const BANK: Readonly<Record<LearnedField, { high: string; low: string }>> = {
  curiosity: { high: '[PLACEHOLDER] curiosity high', low: '[PLACEHOLDER] curiosity low' },
  aggression: { high: '[PLACEHOLDER] aggression high', low: '[PLACEHOLDER] aggression low' },
  law: { high: '[PLACEHOLDER] law high', low: '[PLACEHOLDER] law low' },
  good: { high: '[PLACEHOLDER] good high', low: '[PLACEHOLDER] good low' },
};

export const UNSURE = '[PLACEHOLDER] unsure';

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
