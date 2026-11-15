import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { resolveSection, SECTION_FORMS } from './sections.ts';

export type RecallResult =
  | { ok: true; section: string; text: string; truncated: boolean }
  | { ok: false; error: 'unknown_section' | 'not_found' | 'unreadable'; message: string };

export const MAX_BYTES = 16384;

// The journal is read from its end, so the newest lines survive a cut.
const JOURNAL_CURRENT = 'journal/current';
// Newlines are counted in the cut prefix up to this many bytes, then the count is reported as "more than".
const COUNT_LIMIT = 8 * 1024 * 1024;
// Size of each bounded read while counting the cut prefix.
const COUNT_CHUNK = 64 * 1024;
const NEWLINE = 0x0a;
const LATER_CUT = '\n(later lines cut)';

const NOT_FOUND: RecallResult = {
  ok: false,
  error: 'not_found',
  message: 'You have no memory of that.',
};
const UNREADABLE: RecallResult = {
  ok: false,
  error: 'unreadable',
  message: "That memory can't be read.",
};

interface Tail {
  // The bytes kept, starting at a line boundary.
  kept: Buffer;
  // True when anything before the kept bytes was left out.
  cut: boolean;
  // Whole lines in the cut prefix, or the cap on that count when countCapped is set.
  lines: number;
  countCapped: boolean;
}

// Opens the file without following a link, and only when it is a regular file. Null otherwise.
function openRegular(file: string): number | null {
  let fd: number;
  try {
    // O_NONBLOCK: a FIFO swapped in after the lstat must not block the read forever.
    fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch {
    return null;
  }
  try {
    if (fstatSync(fd).isFile()) return fd;
  } catch {
    // Fall through: the descriptor is closed below.
  }
  closeSync(fd);
  return null;
}

// Fills buf from the file at position `at` until it is full or the file ends. Returns the bytes read.
function readFill(fd: number, buf: Buffer, at: number): number {
  let n = 0;
  while (n < buf.length) {
    const got = readSync(fd, buf, n, buf.length - n, at + n);
    if (got === 0) break;
    n += got;
  }
  return n;
}

// Reads at most MAX_BYTES + 1 bytes from the start, so the caller can tell a cut file from a whole one.
function readHead(file: string): Buffer | null {
  const fd = openRegular(file);
  if (fd === null) return null;
  try {
    const buf = Buffer.alloc(MAX_BYTES + 1);
    return buf.subarray(0, readFill(fd, buf, 0));
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

// Counts the newlines in the first `end` bytes, reading in bounded chunks and at most COUNT_LIMIT bytes.
function countLines(fd: number, end: number): number {
  const limit = Math.min(end, COUNT_LIMIT);
  const chunk = Buffer.alloc(COUNT_CHUNK);
  let count = 0;
  let at = 0;
  while (at < limit) {
    const view = chunk.subarray(0, Math.min(COUNT_CHUNK, limit - at));
    const got = readFill(fd, view, at);
    if (got === 0) break;
    for (let i = 0; i < got; i++) {
      if (view[i] === NEWLINE) count++;
    }
    at += got;
  }
  return count;
}

// Reads the last MAX_BYTES of the file, then drops the partial first line so no line is cut in half.
function readTail(file: string): Tail | null {
  const fd = openRegular(file);
  if (fd === null) return null;
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - MAX_BYTES);
    const window = Buffer.alloc(size - start);
    const n = readFill(fd, window, start);
    if (start === 0)
      return { kept: window.subarray(0, n), cut: false, lines: 0, countCapped: false };

    // Keep the window whole only when it begins right after a newline. Otherwise drop through the first newline.
    const before = Buffer.alloc(1);
    readFill(fd, before, start - 1);
    let keep = 0;
    if (before[0] !== NEWLINE) {
      const first = window.subarray(0, n).indexOf(NEWLINE);
      keep = first === -1 ? n : first + 1;
    }
    const keepStart = start + keep;
    return {
      kept: window.subarray(keep, n),
      cut: true,
      lines: countLines(fd, keepStart),
      countCapped: keepStart > COUNT_LIMIT,
    };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

export function recall(root: string, section: string): RecallResult {
  const file = resolveSection(section);
  if (file === null) {
    return {
      ok: false,
      error: 'unknown_section',
      message: `No such section. Sections: ${SECTION_FORMS.join(', ')}`,
    };
  }

  // Walk the file's components from the root. Never follow a link.
  const parts = file.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i] ?? '');
    const st = lstatSync(current, { throwIfNoEntry: false });
    if (st === undefined) return NOT_FOUND;
    if (st.isSymbolicLink()) return UNREADABLE;
    const isLast = i === parts.length - 1;
    if (isLast ? !st.isFile() : !st.isDirectory()) return UNREADABLE;
  }

  if (section === JOURNAL_CURRENT) {
    const tail = readTail(current);
    if (tail === null) return UNREADABLE;
    const kept = tail.kept.toString('utf8');
    if (!tail.cut) return { ok: true, section, text: kept, truncated: false };
    const shown = tail.countCapped ? `more than ${tail.lines}` : `${tail.lines}`;
    return {
      ok: true,
      section,
      text: `(older lines cut: ${shown})\n${kept}`,
      truncated: true,
    };
  }

  const bytes = readHead(current);
  if (bytes === null) return UNREADABLE;

  const truncated = bytes.length > MAX_BYTES;
  let text = bytes.subarray(0, Math.min(bytes.length, MAX_BYTES)).toString('utf8');
  // A character cut in half at the limit decodes to one trailing U+FFFD. Drop it, but only when cut.
  if (truncated && text.endsWith('�')) text = text.slice(0, -1);
  if (truncated) text += LATER_CUT;
  return { ok: true, section, text, truncated };
}
