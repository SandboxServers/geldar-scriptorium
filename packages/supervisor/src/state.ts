import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Deps } from './deps.ts';
import type { Settings } from './settings.ts';
import { statePath } from './settings.ts';

/** UTC text for an epoch second: `2026-01-10T23:00:00Z`, or just the date. */
export function fmt(epoch: number, kind: 'stamp' | 'date'): string {
  const iso = new Date(epoch * 1000).toISOString();
  return kind === 'date' ? iso.slice(0, 10) : `${iso.slice(0, 19)}Z`;
}

/** Writes a file owner-only (0600), replacing any older one whole. */
export function writePrivate(path: string, text: string, mode = 0o600): void {
  const tmp = `${path}.new`;
  writeFileSync(tmp, text, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
}

/** The next run number: one more than the highest session-<n>.jsonl in the state directory. */
export function nextRunNumber(stateDir: string): number {
  let max = 0;
  for (const name of readdirSync(stateDir)) {
    const m = /^session-([0-9]{1,9})\.jsonl$/.exec(name);
    if (m?.[1] !== undefined) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  return max + 1;
}

/** Cost summed over the lines of costs.csv (`run,utc,turns,cost`) whose time starts with the UTC date. */
export function costToday(stateDir: string, date: string): number {
  const file = join(stateDir, 'costs.csv');
  if (!existsSync(file)) return 0;
  let sum = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const cols = line.split(',');
    if (cols[1]?.startsWith(date)) sum += Number(cols[3]) || 0;
  }
  return Math.round(sum * 10000) / 10000;
}

/** The first line of STOP, or null when there is none. */
export function readStop(settings: Settings): string | null {
  const file = statePath(settings, 'STOP');
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8').split('\n')[0] ?? '';
}

/** Writes the STOP file the supervisor itself uses (the first line starts with `auto: `). */
export function writeAutoStop(settings: Settings, reason: string): void {
  writePrivate(statePath(settings, 'STOP'), `auto: ${reason}\n`);
}

/**
 * Takes the single-supervisor lock: a folder with its pid file already in it, put in place by one
 * rename. An empty or unreadable pid means someone is starting (waits up to 2 seconds); stale when
 * the pid is not a live supervisor (see holderIsLive). Returns false when another supervisor lives.
 */
export async function acquireLock(settings: Settings, deps: Deps): Promise<boolean> {
  const lock = statePath(settings, 'lock');
  const tmp = `${lock}.${deps.pid}`;
  for (let waited = 0; ; ) {
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp);
    writeFileSync(join(tmp, 'pid'), `${deps.pid}\n`);
    if (!existsSync(lock)) {
      try {
        renameSync(tmp, lock);
        if (readFileSync(join(lock, 'pid'), 'utf8').trim() === String(deps.pid)) return true;
      } catch {
        // Lost the race: fall through to look at the holder.
      }
    }
    rmSync(tmp, { recursive: true, force: true });
    let pid = '';
    try {
      pid = readFileSync(join(lock, 'pid'), 'utf8').trim();
    } catch {
      pid = '';
    }
    if (/^[0-9]+$/.test(pid)) {
      if (holderIsLive(Number.parseInt(pid, 10), deps)) return false;
      rmSync(lock, { recursive: true, force: true });
      continue;
    }
    if (waited >= 4) return false;
    waited++;
    await deps.sleep(0.5, () => false);
  }
}

/**
 * True when the pid in a lock belongs to a running supervisor. Our own pid is never a live holder
 * (a lock left by a previous container can name the pid we have now). A pid that exists but whose
 * command line is another program (docker-init as PID 1 of a recreated container, say) is stale.
 * When the command line cannot be read, the alive check alone decides.
 */
function holderIsLive(pid: number, deps: Deps): boolean {
  if (pid === deps.pid || !deps.alive(pid)) return false;
  const cmdline = deps.cmdline?.(pid) ?? null;
  if (cmdline === null) return true;
  return /geldar-supervisor|packages\/supervisor\/src\/cli\.ts/.test(cmdline);
}

/** Releases the lock taken by acquireLock. */
export function releaseLock(settings: Settings): void {
  rmSync(statePath(settings, 'lock'), { recursive: true, force: true });
}
