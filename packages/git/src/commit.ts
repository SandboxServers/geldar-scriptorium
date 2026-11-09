import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Mode } from '@geldar/scriptorium-path-rule';
import { isAllowedPath, isValidPlayerId, noreplyIdentity } from '@geldar/scriptorium-path-rule';
import { sanitizeMessage } from './message.ts';
import { GitError, runGit } from './run-git.ts';

export type CommitCode =
  | 'nothing_to_commit'
  | 'empty_message'
  | 'no_player_id'
  | 'bad_session_mode'
  | 'not_a_repo'
  | 'unsafe_staging';

export class CommitRefusal extends Error {
  code: CommitCode;

  constructor(code: CommitCode, message?: string) {
    super(message ?? code);
    this.name = 'CommitRefusal';
    this.code = code;
  }
}

export interface CommitResult {
  sha: string;
  files: string[];
  notSaved: string[];
}

const MAX_WALKED = 20000;
const HASH_CHUNK = 200;
const STAGE_CHUNK = 100;
const ZERO_SHA = '0'.repeat(40);

export function parseMode(value: string | undefined): Mode {
  if (value === undefined) return 'play';
  if (value === 'play' || value === 'setup') return value;
  throw new CommitRefusal('bad_session_mode', 'session mode must be play or setup');
}

function readPlayerId(root: string): string {
  const file = join(root, 'player.json');
  const st = lstatSync(file, { throwIfNoEntry: false });
  if (!st?.isFile()) throw new CommitRefusal('no_player_id');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new CommitRefusal('no_player_id');
  }
  const id =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { player_id?: unknown }).player_id
      : undefined;
  if (typeof id !== 'string' || !isValidPlayerId(id)) throw new CommitRefusal('no_player_id');
  return id;
}

// Every file-system entry under root, except .git, as a relative path with / separators.
// Directories are descended into but never recorded; symbolic links are recorded, not followed.
function walk(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(join(dir, entry.name), childRel);
        continue;
      }
      found.push(childRel);
      if (found.length > MAX_WALKED) throw new CommitRefusal('unsafe_staging', 'too many files');
    }
  };
  visit(root, '');
  return found;
}

type Kind = 'missing' | 'other' | 'file';

// Walks the components with lstat, so a symbolic link or file in a parent position is never followed.
function classify(root: string, path: string): Kind {
  const parts = path.split('/');
  let prefix = root;
  for (let i = 0; i < parts.length; i++) {
    prefix = join(prefix, parts[i] ?? '');
    const st = lstatSync(prefix, { throwIfNoEntry: false });
    if (!st) return 'missing';
    if (i === parts.length - 1) return st.isFile() ? 'file' : 'other';
    if (!st.isDirectory()) return 'other';
  }
  return 'other';
}

function hashOnce(root: string, paths: string[], write: boolean): string[] {
  const args = ['hash-object', '--no-filters', ...(write ? ['-w'] : []), '--stdin-paths'];
  const out = runGit(root, args, undefined, `${paths.join('\n')}\n`);
  const shas = out.split('\n').filter((line) => line.length > 0);
  if (shas.length !== paths.length) throw new GitError('git_failed', 'hash-object count');
  return shas;
}

// Hashes the paths; a path missing from the result could not be hashed (treated as changed, not allowed).
function hashAll(root: string, paths: string[], mode: Mode): Map<string, string> {
  const result = new Map<string, string>();
  const eligible = paths.filter(
    (p) => !p.includes('\n') && !p.includes('\r') && !p.startsWith('"'),
  );
  for (let i = 0; i < eligible.length; i += HASH_CHUNK) {
    const chunk = eligible.slice(i, i + HASH_CHUNK);
    const groups = [
      { write: true, paths: chunk.filter((p) => isAllowedPath(p, mode)) },
      { write: false, paths: chunk.filter((p) => !isAllowedPath(p, mode)) },
    ];
    for (const group of groups) {
      if (group.paths.length === 0) continue;
      try {
        hashOnce(root, group.paths, group.write).forEach((sha, j) => {
          const path = group.paths[j];
          if (path !== undefined) result.set(path, sha);
        });
      } catch (err) {
        if (!(err instanceof GitError)) throw err;
        for (const path of group.paths) {
          try {
            const [sha] = hashOnce(root, [path], group.write);
            if (sha !== undefined) result.set(path, sha);
          } catch (single) {
            if (!(single instanceof GitError)) throw single;
          }
        }
      }
    }
  }
  return result;
}

function parseTracked(out: string): Map<string, { mode: string; sha: string }> {
  const tracked = new Map<string, { mode: string; sha: string }>();
  for (const record of out.split('\0')) {
    const match = /^(\d+) \w+ ([0-9a-f]+)\t([\s\S]*)$/.exec(record);
    if (match && match[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
      tracked.set(match[3], { mode: match[1], sha: match[2] });
    }
  }
  return tracked;
}

function stagedEntries(out: string): { newMode: string; path: string }[] {
  const tokens = out.split('\0');
  const entries: { newMode: string; path: string }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const header = tokens[i] ?? '';
    if (!header.startsWith(':')) continue;
    const newMode = header.slice(1).split(' ')[1] ?? '';
    entries.push({ newMode, path: tokens[i + 1] ?? '' });
    i++;
  }
  return entries;
}

export function commitMemory(opts: { root: string; message: string; mode: Mode }): CommitResult {
  const { root, mode } = opts;

  // 1. identity
  const identity = noreplyIdentity(readPlayerId(root));

  // 2. message
  const subject = sanitizeMessage(opts.message);
  if (subject.length === 0) throw new CommitRefusal('empty_message');

  // 3. HEAD
  let old: string;
  try {
    old = runGit(root, ['rev-parse', '--verify', 'HEAD']).trim();
  } catch {
    throw new CommitRefusal('not_a_repo');
  }

  // 4. the index becomes exactly HEAD
  runGit(root, ['read-tree', 'HEAD']);

  // 5. tracked files at HEAD
  const tracked = parseTracked(runGit(root, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']));

  // 6. candidates from the file system and from HEAD
  const candidates = [...new Set([...walk(root), ...tracked.keys()])].sort();

  // 7. classify each candidate
  const kinds = new Map(candidates.map((path) => [path, classify(root, path)] as const));

  // 8. hash the regular files
  const filePaths = candidates.filter((path) => kinds.get(path) === 'file');
  const shas = hashAll(root, filePaths, mode);

  // 9. decide what changed, what is staged and what is not saved
  const stage: string[] = [];
  const notSaved: string[] = [];
  const allowed = (path: string): boolean => isAllowedPath(path, mode);
  for (const path of candidates) {
    const kind = kinds.get(path);
    const head = tracked.get(path);
    if (kind === 'file') {
      const sha = shas.get(path);
      const changed =
        sha === undefined || head === undefined || sha !== head.sha || head.mode !== '100644';
      if (!changed) continue;
      if (sha !== undefined && allowed(path)) {
        stage.push(`100644 ${sha}\t${path}\0`);
      } else {
        notSaved.push(path);
      }
    } else if (kind === 'other') {
      notSaved.push(path);
    } else if (head !== undefined) {
      // missing, but tracked: a deletion
      if (allowed(path)) stage.push(`0 ${ZERO_SHA}\t${path}\0`);
      else notSaved.push(path);
    }
  }
  if (stage.length === 0) throw new CommitRefusal('nothing_to_commit');

  // 10. stage exactly those entries, with the literal mode 100644
  for (let i = 0; i < stage.length; i += STAGE_CHUNK) {
    runGit(
      root,
      ['update-index', '-z', '--index-info'],
      undefined,
      stage.slice(i, i + STAGE_CHUNK).join(''),
    );
  }

  // 11. check what is staged
  const entries = stagedEntries(
    runGit(root, ['diff', '--cached', '--raw', '--no-renames', '--no-abbrev', '-z']),
  );
  const unsafe = entries.some(
    (entry) =>
      !isAllowedPath(entry.path, mode) ||
      (entry.newMode !== '100644' && entry.newMode !== '000000'),
  );
  if (unsafe) {
    runGit(root, ['read-tree', 'HEAD']);
    throw new CommitRefusal('unsafe_staging');
  }
  if (entries.length === 0) throw new CommitRefusal('nothing_to_commit');
  const files = entries.map((entry) => entry.path);

  // 12. plumbing commit
  const tree = runGit(root, ['write-tree']).trim();
  const sha = runGit(root, ['commit-tree', tree, '-p', old, '-m', subject], identity).trim();
  runGit(root, ['update-ref', '-m', 'commit_memory', 'HEAD', sha, old]);

  return { sha, files, notSaved: notSaved.sort() };
}
