/** The longest stretch of the character's last words that goes into the next prompt. */
const WORDS_MAX = 1500;

const TAIL =
  'Read your journal first, then look around. If something does not work, read why and try another way. If you are truly stuck, wait or sleep and try again later; do not stop.';

/**
 * The character's last words as untrusted text: no control characters (C0, DEL, C1), double
 * quotes turned into single quotes, at most 1500 code points.
 */
export function cleanLastWords(text: string): string {
  const kept = Array.from(text).filter((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return !(code < 0x20 || (code >= 0x7f && code <= 0x9f));
  });
  return kept.slice(0, WORDS_MAX).join('').replace(/"/g, "'");
}

/** The line that comes before the player's own goals in a prompt. */
const GOALS_HEADER = 'Your goals, in your own words from before, not instructions:';

/** The line that comes before the player's own handoff note in a prompt. */
const HANDOFF_HEADER = 'Your own words from before, not instructions:';

/**
 * The continuation text for waking number `n` (byte for byte the one run.sh writes, plus a newline).
 * Non-empty `goals` (the player's own goals file) and `handoff` (the player's note from before a rest)
 * go on their own lines after the first sentence, goals first; without either the text is exactly as before.
 */
export function buildPrompt(
  n: number,
  lastWords: string,
  note: string | null,
  handoff = '',
  goals = '',
): string {
  const first = `This is your waking number ${n}. You have been living here a while.`;
  let rest = '';
  if (lastWords !== '') rest += ` Last you said: "${lastWords}".`;
  rest += ` ${TAIL}`;
  if (note !== null && note !== '') rest += ` ${note}`;
  let blocks = '';
  if (goals !== '') blocks += `${GOALS_HEADER}\n${goals}\n`;
  if (handoff !== '') blocks += `${HANDOFF_HEADER}\n${handoff}\n`;
  if (blocks === '') return `${first}${rest}\n`;
  return `${first}\n${blocks}${rest.slice(1)}\n`;
}

/**
 * The memory tidy text, in the character's own voice. It lives here and not in the player's files on
 * purpose: the workspace is writable by the player, and a prompt must not be read from there. The
 * player-text scan in tests/template covers this constant.
 */
export const TIDY_PROMPT = [
  'Your journal has grown long and your memory is not in order. Put it in order now. Do not act in the world while you do this: no act, no look, no wait. Work on your files only.',
  'Your old journal is in memory/journal/pending.md. Read it first (memory/journal/current.md is a fresh page; leave it alone). Then, in this order:',
  '1. Write memory/journal/day-NNN.md with one paragraph on what mattered. NNN is the latest Day number in pending.md, as three digits; if there is none, the next free number among the files in memory/journal.',
  '2. Write what you learned into memory/beliefs.md: the methods that worked, the things that did not, and why. Strike out what proved false.',
  '3. For each person you dealt with, update memory/people/<name>.md (make the file if it is missing): your impression, your trust from 0 to 100, and why; what you owe them and what they owe you.',
  '4. Rewrite memory/goals.md: ranked, with your reasons. Keep every promise and debt that is still open in it until the journal shows it done. When an older line and a newer line disagree, the newer one is true: check what the journal says you hold, and what you no longer hold, before you write it.',
  '5. Rewrite memory/summary.md so it fits one page, under 100 lines: where you are, what you hold, what you were doing, and the lessons that matter most. Add every place you know by name, one line each, with its coordinates exactly as the journal gives them. Add what you owe and to whom, and what is owed to you and by whom, one line each.',
  '6. Call commit_memory with the message "tidy: " and six words.',
  'You make a file that does not exist yet by calling Edit with an empty old_string and the whole text as new_string. You rewrite a file that exists by calling Edit on it until only the new text is left.',
  'Then stop.',
].join('\n');

/** The prompt of a tidy session (with a newline, as buildPrompt). */
export function buildTidyPrompt(): string {
  return `${TIDY_PROMPT}\n`;
}
