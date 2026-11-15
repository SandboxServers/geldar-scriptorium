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
 * root, at most `maxBytes` bytes. Every component is checked with lstat: a symlink, a directory, a
 * FIFO or a device at that path gives ''. So does a missing or unreadable file. The text is untrusted
 * and is cleaned the way the hook cleans it: control characters out (newline and tab kept), C1 out,
 * no half character at the end, trailing whitespace trimmed.
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
      if (!fstatSync(fd).isFile()) return '';
      const buf = Buffer.alloc(maxBytes);
      let total = 0;
      while (total < maxBytes) {
        const got = readSync(fd, buf, total, maxBytes - total, null);
        if (got === 0) break;
        total += got;
      }
      return clean(buf.subarray(0, total));
    } finally {
      closeSync(fd);
    }
  } catch {
    return '';
  }
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
