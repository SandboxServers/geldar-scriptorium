// The agent's own authorized knowledge as one lowercase text: its beliefs, its summary, its current journal and the
// file names of the people it knows. Only files under the workspace's memory/ are read; links, folders and unreadable
// files are skipped. The text is used for whole-word matches only and never reaches a fact.
import { closeSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { join } from 'node:path';

/** The most bytes read from one memory file. A longer file contributes its first 32 KiB. */
export const KNOWN_FILE_MAX = 32 * 1024;
/** The most people file names read from memory/people. */
export const KNOWN_NAMES_MAX = 40;

const KNOWN_FILES = ['beliefs.md', 'summary.md', join('journal', 'current.md')];

/** The first KNOWN_FILE_MAX bytes of a regular file, or null when it is missing, a link, a folder or unreadable. */
function readCapped(file: string): string | null {
  let fd: number | undefined;
  try {
    if (!lstatSync(file).isFile()) return null;
    fd = openSync(file, 'r');
    const buffer = Buffer.alloc(KNOWN_FILE_MAX);
    const read = readSync(fd, buffer, 0, KNOWN_FILE_MAX, 0);
    return buffer.subarray(0, read).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The names of the plain files in memory/people, sorted, at most KNOWN_NAMES_MAX of them. */
function peopleNames(memory: string): string[] {
  try {
    return readdirSync(join(memory, 'people'), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()
      .slice(0, KNOWN_NAMES_MAX);
  } catch {
    return [];
  }
}

/** The lowercase known text of the workspace; '' when the workspace is unset. */
export function readKnownText(workspace: string | undefined): string {
  if (workspace === undefined || workspace === '') return '';
  const memory = join(workspace, 'memory');
  const parts: string[] = [];
  for (const name of KNOWN_FILES) {
    const text = readCapped(join(memory, name));
    if (text !== null) parts.push(text);
  }
  parts.push(...peopleNames(memory));
  return parts.join('\n').toLowerCase();
}
