import type { GitIdentity, Mode } from '@geldar/scriptorium-path-rule';
import {
  identityLocked,
  isAllowedPath,
  isIdentityPath,
  noreplyIdentity,
} from '@geldar/scriptorium-path-rule';
import type { Reason } from './reasons.ts';
import { git } from './run-git.ts';

export interface HistoryContext {
  repo: string;
  start: string;
  tip: string;
  mode: Mode;
  playerId: string;
}

// One path entry from git diff-tree --raw (with --no-renames, so one path per entry).
export interface RawEntry {
  oldMode: string;
  newMode: string;
  path: string;
}

// One commit from git log. complete is false when the record did not have 6 fields.
export interface LogRecord {
  sha: string;
  author: GitIdentity;
  committer: GitIdentity;
  complete: boolean;
}

const EMPTY_IDENTITY: GitIdentity = { name: '', email: '' };

// Splits -z output on NUL. The last element is the one empty string after the final NUL.
function splitRecords(out: string): string[] {
  const chunks = out.split('\0');
  if (chunks[chunks.length - 1] === '') chunks.pop();
  return chunks;
}

// -z raw output: ":<oldmode> <newmode> <oldsha> <newsha> <status>" then the path, each ending in NUL.
export function parseRaw(out: string): RawEntry[] {
  const tokens = splitRecords(out);
  const entries: RawEntry[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const header = tokens[i] ?? '';
    const path = tokens[i + 1];
    if (!header.startsWith(':') || path === undefined) {
      throw new Error('malformed diff-tree output');
    }
    const parts = header.slice(1).split(' ');
    const oldMode = parts[0];
    const newMode = parts[1];
    if (parts.length !== 5 || oldMode === undefined || newMode === undefined) {
      throw new Error('malformed diff-tree header');
    }
    entries.push({ oldMode, newMode, path });
  }
  return entries;
}

// Records split on NUL, fields on US (0x1f). A record that is not 6 fields is kept but marked incomplete.
export function parseLog(out: string): LogRecord[] {
  return splitRecords(out).map((chunk) => {
    const fields = chunk.split('\x1f');
    const sha = fields[0] ?? '';
    if (fields.length !== 6) {
      return { sha, author: EMPTY_IDENTITY, committer: EMPTY_IDENTITY, complete: false };
    }
    return {
      sha,
      author: { name: fields[2] ?? '', email: fields[3] ?? '' },
      committer: { name: fields[4] ?? '', email: fields[5] ?? '' },
      complete: true,
    };
  });
}

// The reasons one path entry earns. Identity is checked before the path rule.
export function reasonsFor(entry: RawEntry, mode: Mode): Reason[] {
  const found: Reason[] = [];
  if (isIdentityPath(entry.path) && identityLocked(mode)) {
    found.push('identity_changed');
  } else if (!isAllowedPath(entry.path, mode)) {
    found.push('path_not_allowed');
  }
  switch (entry.newMode) {
    case '100644':
    case '000000':
      break;
    case '120000':
      found.push('symlink_not_allowed');
      break;
    case '160000':
      found.push('gitlink_not_allowed');
      break;
    case '100755':
      found.push('executable_not_allowed');
      break;
    default:
      found.push('bad_mode');
  }
  return found;
}

function sameIdentity(a: GitIdentity, b: GitIdentity): boolean {
  return a.name === b.name && a.email === b.email;
}

// A non-zero status throws, and verify turns the throw into verify_error.
function runOrThrow(run: typeof git, repo: string, args: readonly string[]): string {
  const result = run(repo, args);
  if (result.status !== 0) throw new Error(`git ${args[0] ?? ''} failed`);
  return result.stdout;
}

// Steps 1 to 5 of the verify procedure: identities, each commit, the net change.
// Every git call goes through run, so tests can inject a fake.
export function checkHistory(ctx: HistoryContext, run: typeof git = git): Reason[] {
  const found = new Set<Reason>();
  const noreply = noreplyIdentity(ctx.playerId);

  // Step 1: identities for every commit in START..tip.
  const logOut = runOrThrow(run, ctx.repo, [
    'log',
    '-z',
    '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%cn%x1f%ce',
    `${ctx.start}..${ctx.tip}`,
  ]);
  const records = parseLog(logOut);
  for (const record of records) {
    const ok =
      record.complete &&
      sameIdentity(record.author, noreply) &&
      sameIdentity(record.committer, noreply);
    if (!ok) found.add('identity_mismatch');
  }

  // Step 2: each commit on its own, so a file added and later removed is still seen.
  const entries: RawEntry[] = [];
  for (const record of records) {
    const out = runOrThrow(run, ctx.repo, [
      'diff-tree',
      '-r',
      '--raw',
      '--no-renames',
      '--no-abbrev',
      '-z',
      '--no-commit-id',
      '--root',
      record.sha,
    ]);
    entries.push(...parseRaw(out));
  }

  // Step 3: the net change from START to the tip, checked independently.
  const netOut = runOrThrow(run, ctx.repo, [
    'diff-tree',
    '-r',
    '--raw',
    '--no-renames',
    '--no-abbrev',
    '-z',
    ctx.start,
    ctx.tip,
  ]);
  entries.push(...parseRaw(netOut));

  // Step 4: every entry from steps 2 and 3 goes through reasonsFor.
  for (const entry of entries) {
    for (const reason of reasonsFor(entry, ctx.mode)) found.add(reason);
  }
  return [...found];
}
