import { lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VerifyInput } from './args.ts';
import { checkHistory } from './history.ts';
import type { Reason, Verdict } from './reasons.ts';
import { verdict } from './reasons.ts';
import { git } from './run-git.ts';

export const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;
const NL = String.fromCharCode(10);
export const MAX_COMMITS = 2000;
// Per-blob cap (H-10). A memory, skill or journal file is a few KiB of text; 2 MiB is far above
// any of them. Without it a 200 MiB blob of zeros fits a tiny bundle and then fills the human's
// disk on the fast-forward. Reported as bundle_too_large (the card already says "far too much").
export const MAX_BLOB_BYTES = 2 * 1024 * 1024;

// Runs one git call and throws on a non-zero exit. A throw becomes verify_error.
function must(repo: string, args: readonly string[]): string {
  const result = git(repo, args);
  if (result.status !== 0) throw new Error(`git ${args[0] ?? ''} failed`);
  return result.stdout;
}

// Step 9b: no new blob may exceed MAX_BLOB_BYTES. Sizes come from the object headers
// (cat-file --batch-check), so nothing is inflated.
function hasOversizeBlob(repo: string, start: string, tip: string): boolean {
  const objects = must(repo, ['rev-list', '--objects', tip, '--not', start]);
  const ids = objects
    .split(NL)
    .map((line) => line.split(' ')[0] ?? '')
    .filter((id) => id !== '');
  if (ids.length === 0) return false;
  const sized = git(
    repo,
    ['cat-file', '--batch-check=%(objecttype) %(objectsize)'],
    `${ids.join(NL)}${NL}`,
  );
  if (sized.status !== 0) throw new Error('git cat-file failed');
  return sized.stdout.split(NL).some((line) => {
    const [type, size] = line.split(' ');
    return type === 'blob' && Number(size) > MAX_BLOB_BYTES;
  });
}

// Steps 2 to 10 of the verify procedure. Returns the reasons found; [] means no problem.
function inspect(input: VerifyInput, scratch: string, maxCommits: number): Reason[] {
  const repo = join(scratch, 'repo');
  must(scratch, ['init', '--bare', '-q', repo]);

  // Step 3: exactly one ref, and it is refs/heads/<branch>.
  const heads = git(repo, ['bundle', 'list-heads', input.bundle]);
  if (heads.status !== 0) return ['bundle_unreadable'];
  const lines = heads.stdout.split('\n').filter((line) => line.trim() !== '');
  const parts = lines.length === 1 ? (lines[0] ?? '').trim().split(/\s+/) : [];
  if (parts.length !== 2 || parts[1] !== `refs/heads/${input.branch}`) {
    return ['bundle_refs_unexpected'];
  }

  // Step 4: fetch with object checks (H-12).
  const fetched = git(repo, [
    '-c',
    'fetch.fsckObjects=true',
    '-c',
    'transfer.fsckObjects=true',
    'fetch',
    '--no-tags',
    input.bundle,
    `refs/heads/${input.branch}:refs/launcher/incoming`,
  ]);
  if (fetched.status !== 0) return ['bundle_fetch_failed'];

  // Step 5: the tip must resolve to a commit.
  const tipResult = git(repo, [
    'rev-parse',
    '--verify',
    '--quiet',
    'refs/launcher/incoming^{commit}',
  ]);
  const tip = tipResult.stdout.trim();
  if (tipResult.status !== 0 || tip === '') return ['bundle_fetch_failed'];

  // Step 6: no new commits changes nothing.
  if (tip === input.start) return [];

  // Step 7: START must be an ancestor of the tip.
  if (git(repo, ['merge-base', '--is-ancestor', input.start, tip]).status !== 0) {
    return ['not_fast_forward'];
  }

  // Step 8: bound the number of commits.
  const countText = must(repo, ['rev-list', '--count', `${input.start}..${tip}`]).trim();
  if (!/^\d+$/.test(countText)) throw new Error('commit count is not a number');
  if (Number(countText) > maxCommits) return ['too_many_commits'];

  // Step 9: merge commits are a reason, and the checks continue.
  const merges = must(repo, ['rev-list', '--min-parents=2', `${input.start}..${tip}`]);
  const reasons: Reason[] = merges.trim() === '' ? [] : ['merge_commit'];

  // Step 9b: per-blob cap.
  if (hasOversizeBlob(repo, input.start, tip)) return ['bundle_too_large'];

  // Step 10: history checks (SC-23b).
  const history = checkHistory({
    repo,
    start: input.start,
    tip,
    mode: input.mode,
    playerId: input.playerId,
  });
  return [...reasons, ...history];
}

// Synchronous. Any thrown error (a git call that timed out included) is verify_error.
// The scratch folder is removed in finally, for ok and rejected runs alike.
export function verify(input: VerifyInput, maxCommits = MAX_COMMITS): Verdict {
  let scratch: string | undefined;
  try {
    // Step 1: missing or not a regular file, or over the cap (strictly greater).
    const stat = lstatSync(input.bundle, { throwIfNoEntry: false });
    if (stat === undefined || !stat.isFile()) return verdict(['bundle_unreadable']);
    if (stat.size > MAX_BUNDLE_BYTES) return verdict(['bundle_too_large']);

    // Step 2: scratch folder for the bare repo.
    scratch = mkdtempSync(join(tmpdir(), 'geldar-verify-'));
    return verdict(inspect(input, scratch, maxCommits));
  } catch {
    return verdict(['verify_error']);
  } finally {
    // A git child killed by the timeout can still hold the folder for a moment on Windows.
    if (scratch !== undefined) {
      try {
        rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Leftover scratch is reported by the scratch test; the verdict itself is unchanged.
      }
    }
  }
}
