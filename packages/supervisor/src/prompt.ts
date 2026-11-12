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

/** The continuation text for waking number `n` (byte for byte the one run.sh writes, plus a newline). */
export function buildPrompt(n: number, lastWords: string, note: string | null): string {
  let text = `This is your waking number ${n}. You have been living here a while.`;
  if (lastWords !== '') text += ` Last you said: "${lastWords}".`;
  text += ` ${TAIL}`;
  if (note !== null && note !== '') text += ` ${note}`;
  return `${text}\n`;
}
