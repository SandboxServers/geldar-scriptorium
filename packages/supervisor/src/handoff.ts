import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

/** The most bytes of the player's note that go into a prompt (the same cut the session-start hook makes). */
const HANDOFF_MAX = 4000;

/** The most bytes of the player's own goals that go into a prompt. */
const GOALS_MAX = 3000;

/**
 * The player's own note from before a rest, read fresh from memory/journal/handoff.md under the
 * workspace root. The same rules as readOwnFile: '' for a missing, linked, unreadable or non-file path.
 */
export function readHandoff(workspaceRoot: string): string {
  return readOwnFile(workspaceRoot, 'memory/journal/handoff.md', HANDOFF_MAX);
}

/** The player's own goals, read fresh from memory/goals.md under the workspace root (see readOwnFile). */
export function readGoals(workspaceRoot: string): string {
  return readOwnFile(workspaceRoot, 'memory/goals.md', GOALS_MAX);
}

/**
 * A text file of the player's own, read fresh from `relPath` (slash-separated) under the workspace
 * root. At most the last `maxBytes` bytes are read, since the player keeps adding to these files and
 * the newest text is at the end. A longer file starts after its first newline in that window, so no
 * line starts half-way. Every component is checked with lstat: a symlink, a directory, a FIFO or a
 * device at that path gives ''. So does a missing or unreadable file. The text is untrusted and is
 * cleaned the way the hook cleans it: control characters out (newline and tab kept), C1 out, no half
 * character at either end, trailing whitespace trimmed.
 */
export function readOwnFile(workspaceRoot: string, relPath: string, maxBytes: number): string {
  try {
    const parts = relPath.split('/');
    const name = parts.pop() ?? '';
    let dir = workspaceRoot;
    for (const part of parts) {
      dir = join(dir, part);
      // lstat does not follow links: a symlinked folder is not a directory here.
      if (!lstatSync(dir).isDirectory()) return '';
    }
    const path = join(dir, name);
    if (!lstatSync(path).isFile()) return '';
    const flags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);
    const fd = openSync(path, flags);
    try {
      const info = fstatSync(fd);
      if (!info.isFile()) return '';
      const start = Math.max(0, info.size - maxBytes);
      const want = info.size - start;
      const buf = Buffer.alloc(want);
      let total = 0;
      while (total < want) {
        const got = readSync(fd, buf, total, want - total, start + total);
        if (got === 0) break;
        total += got;
      }
      const window = buf.subarray(0, total);
      return clean(start > 0 ? fromLineStart(window) : window);
    } finally {
      closeSync(fd);
    }
  } catch {
    return '';
  }
}

/**
 * The part of a window cut from the middle of a file that starts at a whole line: after its first
 * newline. A window with no newline, or with nothing but whitespace after its first newline (one long
 * paragraph and a final newline), starts at its first character boundary instead.
 */
function fromLineStart(bytes: Buffer): Buffer {
  const newline = bytes.indexOf(0x0a);
  const after = newline >= 0 ? bytes.subarray(newline + 1) : null;
  if (after && after.toString('utf8').trim() !== '') return after;
  let start = 0;
  while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start++;
  return bytes.subarray(start);
}

/** The text of the bytes, without an incomplete UTF-8 sequence at the end and without bad controls. */
function clean(bytes: Buffer): string {
  const text = new TextDecoder('utf-8').decode(bytes.subarray(0, completeEnd(bytes)));
  const kept = Array.from(text).filter((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a) return true;
    return !(code < 0x20 || (code >= 0x7f && code <= 0x9f));
  });
  return kept.join('').trimEnd();
}

/** The length of `bytes` without its last character if that character is cut short. */
function completeEnd(bytes: Buffer): number {
  for (let back = 1; back <= Math.min(4, bytes.length); back++) {
    const byte = bytes[bytes.length - back] ?? 0;
    if ((byte & 0xc0) === 0x80) continue;
    const need = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return need > back ? bytes.length - back : bytes.length;
  }
  return bytes.length;
}
