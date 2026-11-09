/**
 * merge-packet and push-verified, the integration-branch helpers.
 *
 * Rule when the post-merge check fails: the merge is reverted (hard reset to the
 * pre-merge HEAD, safe because the tree had to be clean), so the wave branch is
 * never left holding a red merge. Nothing here pushes except pushVerified.
 */
import { execFileSync } from 'node:child_process';

export interface Hooks {
  /** Runs the full check on the wave branch; true when green. */
  runCheck: () => boolean;
  /** Regenerates the lockfile; true when it succeeded. */
  runInstall: () => boolean;
  log: (message: string) => void;
}

const WAVE_BRANCH = /^scriptorium\/wave\d+[a-z0-9-]*$/;

function git(cwd: string, args: string[], allowFail = false): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (allowFail) return '';
    const e = error as { stderr?: string; message: string };
    throw new Error(`git ${args.join(' ')} failed: ${e.stderr?.trim() || e.message}`);
  }
}

export function mergePacket(cwd: string, branch: string, hooks: Hooks): void {
  const current = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!WAVE_BRANCH.test(current)) {
    throw new Error(`refusing: ${current} is not a wave branch (scriptorium/wave<N>)`);
  }
  if (git(cwd, ['status', '--porcelain']) !== '') {
    throw new Error('refusing: working tree is not clean');
  }
  git(cwd, ['rev-parse', '--verify', `refs/heads/${branch}`]);
  if (branch === current) throw new Error('refusing: cannot merge a branch into itself');
  const before = git(cwd, ['rev-parse', 'HEAD']);
  try {
    git(cwd, ['merge', '--no-ff', '--no-edit', branch]);
  } catch {
    const conflicted = git(cwd, ['diff', '--name-only', '--diff-filter=U'])
      .split('\n')
      .filter(Boolean);
    if (conflicted.length === 1 && conflicted[0] === 'pnpm-lock.yaml') {
      hooks.log('conflict in pnpm-lock.yaml only: keeping the wave branch version, regenerating');
      git(cwd, ['checkout', '--ours', 'pnpm-lock.yaml']);
      if (!hooks.runInstall()) {
        git(cwd, ['merge', '--abort'], true);
        throw new Error('pnpm install --no-frozen-lockfile failed; merge aborted');
      }
      git(cwd, ['add', 'pnpm-lock.yaml']);
      git(cwd, ['commit', '--no-edit']);
    } else {
      git(cwd, ['merge', '--abort'], true);
      throw new Error(
        `merge conflict, merge aborted; resolve by hand. Conflicted files: ${conflicted.join(', ')}`,
      );
    }
  }
  if (!hooks.runCheck()) {
    git(cwd, ['reset', '--hard', before]);
    throw new Error(
      `check failed on ${current} after merging ${branch}; merge reverted to ${before.slice(0, 7)}`,
    );
  }
  hooks.log(`merged ${branch} into ${current}; check is green. Not pushed: run push-verified.`);
}

export function pushVerified(
  cwd: string,
  push: (branch: string) => void = (b) =>
    void git(cwd, ['push', 'origin', `refs/heads/${b}:refs/heads/${b}`]),
): string {
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === 'HEAD') throw new Error('refusing: detached HEAD');
  push(branch);
  const head = git(cwd, ['rev-parse', 'HEAD']);
  const remote = git(cwd, ['ls-remote', 'origin', `refs/heads/${branch}`]).split(/\s+/)[0] ?? '';
  if (remote !== head) {
    throw new Error(
      `push NOT verified: origin/${branch} is ${remote || 'missing'}, local HEAD is ${head}`,
    );
  }
  return head;
}
