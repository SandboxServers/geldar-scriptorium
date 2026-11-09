import { closeSync, constants, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { resolveSection, SECTION_FORMS } from './sections.ts';

export type RecallResult =
  | { ok: true; section: string; text: string; truncated: boolean }
  | { ok: false; error: 'unknown_section' | 'not_found' | 'unreadable'; message: string };

export const MAX_BYTES = 16384;

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

// Reads at most MAX_BYTES + 1 bytes, so the caller can tell a cut file from a whole one.
function readCapped(file: string): Buffer | null {
  let fd: number;
  try {
    // O_NONBLOCK: a FIFO swapped in after the lstat must not block the read forever.
    fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(MAX_BYTES + 1);
    let n = 0;
    while (n < buf.length) {
      const got = readSync(fd, buf, n, buf.length - n, n);
      if (got === 0) break;
      n += got;
    }
    return buf.subarray(0, n);
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

  const bytes = readCapped(current);
  if (bytes === null) return UNREADABLE;

  const truncated = bytes.length > MAX_BYTES;
  let text = bytes.subarray(0, Math.min(bytes.length, MAX_BYTES)).toString('utf8');
  // A character cut in half at the limit decodes to one trailing U+FFFD. Drop it, but only when cut.
  if (truncated && text.endsWith('�')) text = text.slice(0, -1);
  return { ok: true, section, text, truncated };
}
