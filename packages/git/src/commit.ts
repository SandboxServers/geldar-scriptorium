import { lstatSync, readdirSync, readFileSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import type { Mode } from '@geldar/scriptorium-path-rule';
import { isAllowedPath, isValidPlayerId, noreplyIdentity } from '@geldar/scriptorium-path-rule';
import { HashRefusal, hashRegularFile } from './hash-file.ts';
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

export interface CommitTestHooks {
  afterClassify?: (relPath: string) => void;
}

// Walks the components with lstat, so a symbolic link or file in a parent position is never followed.
function classify(root: string, path: string, ids: Map<string, Stats>): Kind {
  const parts = path.split('/');
  let prefix = root;
  for (let i = 0; i < parts.length; i++) {
    prefix = join(prefix, parts[i] ?? '');
    const st = lstatSync(prefix, { throwIfNoEntry: false });
    if (!st) return 'missing';
    if (i === parts.length - 1) {
      if (!st.isFile()) return 'other';
      ids.set(path, st);
      return 'file';
    }
    if (!st.isDirectory()) return 'other';
  }
  return 'other';
}

// Hashes each file from one O_NOFOLLOW descriptor; a path that cannot be hashed is left out
// of the result (treated as changed, not allowed).
function hashAll(
  root: string,
  paths: string[],
  mode: Mode,
  ids: Map<string, Stats>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const path of paths) {
    if (/[\r\n]/.test(path) || path.startsWith('"')) continue;
    const st = ids.get(path);
    try {
      result.set(
        path,
        hashRegularFile(root, join(root, ...path.split('/')), {
          write: isAllowedPath(path, mode),
          ...(st ? { expect: { dev: st.dev, ino: st.ino } } : {}),
        }),
      );
    } catch (err) {
      if (!(err instanceof HashRefusal) && !(err instanceof GitError)) throw err;
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

export function commitMemory(
  opts: { root: string; message: string; mode: Mode },
  testHooks?: CommitTestHooks,
): CommitResult {
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
  const ids = new Map<string, Stats>();
  const kinds = new Map(candidates.map((path) => [path, classify(root, path, ids)] as const));
  if (testHooks?.afterClassify) {
    for (const path of candidates) testHooks.afterClassify(path);
  }

  // 8. hash the regular files
  const filePaths = candidates.filter((path) => kinds.get(path) === 'file');
  const shas = hashAll(root, filePaths, mode, ids);

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

  // 12a. the final tree, compared with HEAD path by path: anything outside the allowlist fails closed
  const finalTree = parseTracked(runGit(root, ['ls-tree', '-r', '-z', '--full-tree', tree]));
  const changedPaths = [...new Set([...tracked.keys(), ...finalTree.keys()])].filter((path) => {
    const before = tracked.get(path);
    const after = finalTree.get(path);
    return before?.sha !== after?.sha || before?.mode !== after?.mode;
  });
  if (changedPaths.some((path) => !allowed(path))) {
    runGit(root, ['read-tree', 'HEAD']);
    throw new CommitRefusal('unsafe_staging');
  }

  const sha = runGit(root, ['commit-tree', tree, '-p', old, '-m', subject], identity).trim();
  runGit(root, ['update-ref', '-m', 'commit_memory', 'HEAD', sha, old]);

  return { sha, files, notSaved: notSaved.sort() };
}
