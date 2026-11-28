// The supervisor-side name roster (HC-46b): display names mapped to life ids, read from <stateDir>/roster.json. The file
// is written by the supervisor (geldar's players-cli roster export). Only the HC-30a adapter reads it, and the map is never
// passed into an observation, so a life id never reaches the model. Every failure gives an empty map; this never throws.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SAFE_ID } from './store.ts';

const ROSTER_FILE = 'roster.json';
/** The largest roster file read, in bytes. A bigger file is ignored whole. */
const MAX_BYTES = 16 * 1024;
/** The longest display name kept, in characters. */
const MAX_NAME_CHARS = 40;

/** True when the text holds a control character (code point below 0x20, or 0x7f). */
function hasControl(text: string): boolean {
  return [...text].some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

/** One entry is kept only when the name is 1 to 40 characters with no control characters and the id passes SAFE_ID. */
function keepEntry(name: string, id: unknown): id is string {
  const chars = [...name].length;
  return (
    chars >= 1 &&
    chars <= MAX_NAME_CHARS &&
    !hasControl(name) &&
    typeof id === 'string' &&
    SAFE_ID.test(id)
  );
}

/**
 * The names in <stateDir>/roster.json mapped to their life ids. A missing, unreadable, non-regular or over-16-KiB file
 * gives an empty map, and so does a JSON value that is not one object. Entries that fail keepEntry are dropped one by one.
 */
export function readRoster(stateDir: string): Map<string, string> {
  const roster = new Map<string, string>();
  try {
    const path = join(stateDir, ROSTER_FILE);
    const info = statSync(path);
    if (!info.isFile() || info.size > MAX_BYTES) return roster;
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return roster;
    for (const [name, id] of Object.entries(value)) {
      if (keepEntry(name, id)) roster.set(name, id);
    }
  } catch {
    return new Map<string, string>();
  }
  return roster;
}
