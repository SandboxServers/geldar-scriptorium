import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

/** The most bytes of the player's note that go into a prompt (the same cut the session-start hook makes). */
const HANDOFF_MAX = 4000;

/**
 * The player's own note from before a rest, read fresh from memory/journal/handoff.md under the
 * workspace root. Every component is checked with lstat: a symlink, a directory, a FIFO or a device
 * at that path gives ''. So does a missing or unreadable file. The text is untrusted and is cleaned
 * the way the hook cleans it: control characters out (newline and tab kept), C1 out, no half
 * character at the end, trailing whitespace trimmed.
 */
export function readHandoff(workspaceRoot: string): string {
  try {
    let dir = workspaceRoot;
    for (const part of ['memory', 'journal']) {
      dir = join(dir, part);
      // lstat does not follow links: a symlinked folder is not a directory here.
      if (!lstatSync(dir).isDirectory()) return '';
    }
    const path = join(dir, 'handoff.md');
    if (!lstatSync(path).isFile()) return '';
    const flags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);
    const fd = openSync(path, flags);
    try {
      if (!fstatSync(fd).isFile()) return '';
      const buf = Buffer.alloc(HANDOFF_MAX);
      let total = 0;
      while (total < HANDOFF_MAX) {
        const got = readSync(fd, buf, total, HANDOFF_MAX - total, null);
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
