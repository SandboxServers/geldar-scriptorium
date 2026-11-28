// The kit-local social store: one JSON file per other life under <stateDir>/social, keyed by the other's id and never by
// a display name (HC-27a). Writes go to a .new file and are renamed into place. A store made for a different life moves
// the old directory to social.archive-<oldlife> and starts fresh, so one life never reads another life's model.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { OtherModel } from './model.ts';

export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;

const FILE_PREFIX = 'other-';
const FILE_SUFFIX = '.json';

interface Meta {
  observer: string;
  life: string;
}

function assertSafe(id: string): void {
  if (!SAFE_ID.test(id)) throw new Error('unsafe social id refused');
}

function readMeta(dir: string): Meta | null {
  try {
    const value: unknown = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
    if (
      typeof value === 'object' &&
      value !== null &&
      'observer' in value &&
      'life' in value &&
      typeof value.observer === 'string' &&
      typeof value.life === 'string'
    )
      return { observer: value.observer, life: value.life };
  } catch {
    // fall through: a meta file that does not parse is treated as missing
  }
  return null;
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.new`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

/** Moves the directory of an earlier life aside. A label that is not a safe id reads as "unknown". */
function archive(stateDir: string, dir: string, oldLife: string | undefined): void {
  const label = oldLife !== undefined && SAFE_ID.test(oldLife) ? oldLife : 'unknown';
  let target = join(stateDir, `social.archive-${label}`);
  for (let i = 2; existsSync(target); i++) target = join(stateDir, `social.archive-${label}-${i}`);
  renameSync(dir, target);
}

function isModel(value: unknown, other: string): value is OtherModel {
  return (
    typeof value === 'object' &&
    value !== null &&
    'v' in value &&
    value.v === 1 &&
    'other' in value &&
    value.other === other &&
    'fields' in value &&
    typeof value.fields === 'object' &&
    value.fields !== null
  );
}

export class SocialStore {
  private readonly dir: string;
  private readonly observer: string;
  private readonly lifeId: string;

  constructor(stateDir: string, observer: string, lifeId: string) {
    this.dir = join(stateDir, 'social');
    this.observer = observer;
    this.lifeId = lifeId;
    if (existsSync(this.dir)) {
      const meta = readMeta(this.dir);
      if (meta === null || meta.life !== lifeId) archive(stateDir, this.dir, meta?.life);
    }
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const meta = readMeta(this.dir);
    if (meta === null || meta.life !== this.lifeId || meta.observer !== this.observer)
      writeAtomic(
        join(this.dir, 'meta.json'),
        `${JSON.stringify({ observer: this.observer, life: this.lifeId })}\n`,
      );
  }

  private fileOf(id: string): string {
    return join(this.dir, `${FILE_PREFIX}${id}${FILE_SUFFIX}`);
  }

  load(other: string): OtherModel | null {
    assertSafe(other);
    const file = this.fileOf(other);
    if (!existsSync(file)) return null;
    try {
      const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (isModel(value, other)) return value;
    } catch {
      // fall through: a file that does not parse reads as no model
    }
    return null;
  }

  save(m: OtherModel): void {
    assertSafe(m.other);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeAtomic(this.fileOf(m.other), `${JSON.stringify(m)}\n`);
  }

  list(): OtherModel[] {
    if (!existsSync(this.dir)) return [];
    const out: OtherModel[] = [];
    for (const name of readdirSync(this.dir).sort()) {
      if (!name.startsWith(FILE_PREFIX) || !name.endsWith(FILE_SUFFIX)) continue;
      const id = name.slice(FILE_PREFIX.length, -FILE_SUFFIX.length);
      if (!SAFE_ID.test(id)) continue;
      const m = this.load(id);
      if (m !== null) out.push(m);
    }
    return out;
  }
}
