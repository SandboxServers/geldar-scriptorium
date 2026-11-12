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
  /** The head of the upstream bundle on offer, or null when none is offered. */
  upstream_head: string | null;
  /** A short fixed code: offered, none, diverged or refused: <code>. */
  upstream_result: string;
  interval_seconds: number;
  /** Consecutive cycles whose remote fetch failed; 0 after a fetch that worked. */
  remote_failures: number;
  held: boolean;
}

/** The largest failure count kept; it is also the largest GELDAR_KEEPER_FETCH_FAILS allowed. */
export const MAX_REMOTE_FAILURES = 1000;

/** Writes a file through a temporary sibling and a rename, so a reader sees all or nothing. */
export function writeAtomic(file: string, text: string): void {
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

// The consecutive failed remote fetches, kept in the keeper's own state folder so a restart keeps
// the count. A missing or damaged file reads as 0; the value read is capped.
export function readRemoteFailures(state: string): number {
  try {
    const text = readFileSync(join(state, 'remote-failures'), 'utf8').trim();
    return /^\d{1,9}$/.test(text) ? Math.min(Number(text), MAX_REMOTE_FAILURES) : 0;
  } catch {
    return 0;
  }
}

export function writeRemoteFailures(state: string, count: number): void {
  writeAtomic(join(state, 'remote-failures'), `${Math.min(count, MAX_REMOTE_FAILURES)}\n`);
}

export function writeStatus(state: string, status: Status): void {
  writeAtomic(join(state, 'status.json'), `${JSON.stringify(status, null, 2)}\n`);
}

// The modification time of a request file in ms, or null when there is none. Only existence and
// mtime are used; the content is never opened.
export function requestTime(folder: string, name: string): number | null {
  const stat = lstatSync(join(folder, name), { throwIfNoEntry: false });
  return stat === undefined ? null : stat.mtimeMs;
}

export function checkpointRequestTime(supervisorState: string): number | null {
  return requestTime(supervisorState, 'checkpoint-request');
}

// The launcher's sync-request (SC-167): asks for an upstream check now. Same rules as above.
export function syncRequestTime(state: string): number | null {
  return requestTime(state, 'sync-request');
}

// Removes the sync-request only when it is still the one the cycle served (its mtime is
// `served`). One written during the cycle is kept, so the next wait wakes at once for it.
export function serveSyncRequest(state: string, served: number | null): void {
  if (syncRequestTime(state) === served) removeIfPresent(join(state, 'sync-request'));
}

export function removeIfPresent(file: string): void {
  rmSync(file, { force: true });
}
