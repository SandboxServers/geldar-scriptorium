// The adopted goal: the first ranked line of the agent's own memory/goals.md in the workspace. The file is the agent's
// writing, so it is data: it is never put into a fact, a why or an audit line. Any failure reads as no goal.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The largest goals.md read; a bigger file is ignored (no goal). */
export const GOAL_FILE_MAX = 16 * 1024;
/** The longest goal text kept. */
export const GOAL_MAX_CHARS = 200;

/** A ranked list line: a bullet or a number, then the text. The text is group 1. */
const RANKED_LINE = /^\s*(?:[-*]|[0-9]+[.)])\s+(.+?)\s*$/;

/**
 * The first ranked line of `<workspace>/memory/goals.md`, trimmed, cut to 200 characters and with control characters
 * removed. Null when the workspace is unset, the file is missing, unreadable, not a regular file or over 16 KiB, or
 * has no ranked line.
 */
export function readAdoptedGoal(workspace: string | undefined): string | null {
  if (workspace === undefined || workspace === '') return null;
  try {
    const file = join(workspace, 'memory', 'goals.md');
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > GOAL_FILE_MAX) return null;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = RANKED_LINE.exec(line);
      if (match === null) continue;
      const goal = (match[1] ?? '')
        .trim()
        .slice(0, GOAL_MAX_CHARS)
        // biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are the point
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim();
      return goal === '' ? null : goal;
    }
    return null;
  } catch {
    return null;
  }
}
