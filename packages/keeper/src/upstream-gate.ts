import { MAX_BLOB_BYTES } from '@geldar/scriptorium-verify';
import { call, Refusal } from './clone.ts';
import type { KeeperConfig } from './config.ts';
import type { GitResult } from './git.ts';
import type { KeeperDeps } from './keeper.ts';

// The checks on upstream commits (SC-167). Not the workspace gate: upstream may add template
// files outside memory/, but nothing it changes may reach memory/, a link, a submodule or a path
// that leaves the workspace.

/** The most commits one upstream offer may carry. */
export const MAX_UPSTREAM_COMMITS = 200;

const NUL = '\0';
const SYMLINK = '120000';
const GITLINK = '160000';

// The stdout of a call that must succeed, untrimmed (a path may end in whitespace).
function output(result: GitResult): string {
  if (result.status !== 0) throw new Refusal('upstream_error');
  return result.stdout;
}

/** True for a path that could leave the workspace or hide git metadata. */
export function unsafePath(path: string): boolean {
  if (path === '' || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return true;
  }
  return path
    .split('/')
    .some((part) => part === '' || part === '.' || part === '..' || part.toLowerCase() === '.git');
}

/** True for memory/ itself and anything under it, in any letter case. */
export function touchesMemory(path: string): boolean {
  const lower = path.toLowerCase();
  return lower === 'memory' || lower.startsWith('memory/');
}

// Every entry a commit changes, against its first parent. -z keeps paths exact; the raw
// entries come as pairs: ":<oldmode> <newmode> <oldsha> <newsha> <status>" then the path.
function inspectCommit(cfg: KeeperConfig, deps: KeeperDeps, sha: string): string | null {
  const raw = output(
    call(cfg, deps, [
      'diff-tree',
      '-r',
      '-z',
      '--raw',
      '--no-renames',
      '--no-commit-id',
      '--root',
      '--diff-merges=first-parent',
      sha,
    ]),
  );
  const fields = raw.split(NUL);
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [oldMode = '', newMode = ''] = (fields[i] ?? '').replace(/^:/, '').split(' ');
    const path = fields[i + 1] ?? '';
    if (oldMode === SYMLINK || newMode === SYMLINK) return 'symlink';
    if (oldMode === GITLINK || newMode === GITLINK) return 'submodule';
    if (unsafePath(path)) return 'path_escape';
    if (touchesMemory(path)) return 'touches_memory';
  }
  return null;
}

/**
 * Checks the commits from base to head. Returns the first refusal code, or null when all pass.
 * A blob over MAX_BLOB_BYTES is found by rev-list's blob filter: the omitted objects are printed
 * with a leading tilde, so nothing is inflated.
 */
export function inspectUpstream(
  cfg: KeeperConfig,
  deps: KeeperDeps,
  base: string,
  head: string,
): string | null {
  const range = `${base}..${head}`;
  const commits = output(call(cfg, deps, ['rev-list', range]))
    .split('\n')
    .filter((line) => line !== '');
  if (commits.length > MAX_UPSTREAM_COMMITS) return 'too_many_commits';
  for (const sha of commits) {
    const code = inspectCommit(cfg, deps, sha);
    if (code !== null) return code;
  }
  const omitted = output(
    call(cfg, deps, [
      'rev-list',
      '--objects',
      '--filter-print-omitted',
      `--filter=blob:limit=${MAX_BLOB_BYTES + 1}`,
      range,
    ]),
  );
  return omitted.split('\n').some((line) => line.startsWith('~')) ? 'blob_too_large' : null;
}

/** The number of commits from base to head. */
export function countUpstream(
  cfg: KeeperConfig,
  deps: KeeperDeps,
  base: string,
  head: string,
): number {
  const text = output(call(cfg, deps, ['rev-list', '--count', `${base}..${head}`])).trim();
  if (!/^\d+$/.test(text)) throw new Refusal('upstream_error');
  return Number(text);
}
