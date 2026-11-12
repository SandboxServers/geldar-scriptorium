import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const SHA = /^[0-9a-f]{40}$/;

export interface Status {
  last_run_utc: string;
  last_result: string;
  last_pushed_head: string | null;
  interval_seconds: number;
  held: boolean;
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text, { mode: 0o644 });
  renameSync(tmp, file);
}

export function ensureState(state: string): void {
  mkdirSync(state, { recursive: true, mode: 0o755 });
}

export function isHeld(state: string): boolean {
  return existsSync(join(state, 'HELD'));
}

// The reason is a short fixed code made by the keeper, never text from git or the workspace.
export function writeHeld(state: string, reason: string): void {
  writeAtomic(join(state, 'HELD'), `${reason}\n`);
}

export function readLastPushed(state: string): string | null {
  try {
    const text = readFileSync(join(state, 'last-pushed-head'), 'utf8').trim();
    return SHA.test(text) ? text : null;
  } catch {
    return null;
  }
}

export function writeLastPushed(state: string, head: string): void {
  writeAtomic(join(state, 'last-pushed-head'), `${head}\n`);
}

export function writeStatus(state: string, status: Status): void {
  writeAtomic(join(state, 'status.json'), `${JSON.stringify(status, null, 2)}\n`);
}

// The modification time of the supervisor's request file in ms, or null when there is none.
// Only existence and mtime are used; the content is never opened.
export function checkpointRequestTime(supervisorState: string): number | null {
  const stat = lstatSync(join(supervisorState, 'checkpoint-request'), { throwIfNoEntry: false });
  return stat === undefined ? null : stat.mtimeMs;
}

export function removeIfPresent(file: string): void {
  rmSync(file, { force: true });
}
