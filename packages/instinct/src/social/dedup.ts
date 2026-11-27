// The seen set of social observation keys (HC-27b). It keeps the newest SEEN_KEEP keys, dropping the oldest first, in
// one JSON file under <stateDir>/social, so a repeated observation counts once, also across a restart. A file that does
// not parse, or is too large, reads as empty. Build it after the SocialStore, which archives a social folder of an earlier
// life together with this file.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The number of keys kept. */
export const SEEN_KEEP = 4000;

const FILE_NAME = 'seen.json';
const MAX_FILE_BYTES = 1024 * 1024;

export class SeenSet {
  private readonly dir: string;
  private readonly file: string;
  private readonly keys: Set<string>;

  constructor(stateDir: string) {
    this.dir = join(stateDir, 'social');
    this.file = join(this.dir, FILE_NAME);
    this.keys = readKeys(this.file);
    this.trim();
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  add(key: string): void {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.trim();
  }

  /** Writes the keys to disk: a .new file renamed into place, mode 0600. */
  flush(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.new`;
    writeFileSync(tmp, `${JSON.stringify([...this.keys])}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  /** Drops the oldest keys until at most SEEN_KEEP remain. Sets keep insertion order. */
  private trim(): void {
    for (const key of this.keys) {
      if (this.keys.size <= SEEN_KEEP) break;
      this.keys.delete(key);
    }
  }
}

function readKeys(file: string): Set<string> {
  const out = new Set<string>();
  try {
    if (statSync(file).size > MAX_FILE_BYTES) return out;
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(value)) return out;
    for (const key of value) if (typeof key === 'string') out.add(key);
  } catch {
    // fall through: a missing or unreadable file reads as an empty set
  }
  return out;
}
