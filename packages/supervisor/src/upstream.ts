import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings } from './settings.ts';

/** The keeper's manifest (`upstream.json`): the upstream head it bundled and the workspace tip it is based on. */
export interface Manifest {
  head: string;
  base: string;
  commits: number;
  created_utc: string;
}

/** `failed: <code>` names the step that refused; the workspace is then back at its HEAD from before. */
export type SyncResult = 'applied' | 'none' | `failed: ${string}`;

/** What one sync leaves behind: the workspace HEAD (null when no git call could tell it) and the result. */
export interface SyncReport {
  result: SyncResult;
  head: string | null;
}

/**
 * One git call as the player: its exit code, and its stdout when `capture` is set. `env` adds
 * variables to the call (the rebase's committer identity).
 */
export type UpstreamGit = (
  args: string[],
  capture: boolean,
  env?: Record<string, string>,
) => Promise<{ code: number; out: string }>;

const SHA = /^[0-9a-f]{40}$/;

/** The git options that keep the apply from running what the workspace or the bundle plants. */
export function hardenedArgs(hooksDir: string): string[] {
  return [
    '-c',
    `core.hooksPath=${hooksDir}`,
    '-c',
    'core.fsmonitor=false',
    '-c',
    'protocol.file.allow=user',
    '-c',
    'fetch.recurseSubmodules=false',
  ];
}

/** The environment that leaves out git's system and global configuration for the apply. */
export const GIT_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
};

/** Reads the keeper's manifest: null when there is none, `invalid` when it is not one. */
export function readManifest(keeperDir: string): Manifest | 'invalid' | null {
  const file = join(keeperDir, 'upstream.json');
  if (!existsSync(file)) return null;
  try {
    const m = JSON.parse(readFileSync(file, 'utf8')) as Partial<Manifest> | null;
    if (
      m &&
      typeof m.head === 'string' &&
      SHA.test(m.head) &&
      typeof m.base === 'string' &&
      SHA.test(m.base) &&
      typeof m.commits === 'number' &&
      typeof m.created_utc === 'string'
    ) {
      return { head: m.head, base: m.base, commits: m.commits, created_utc: m.created_utc };
    }
  } catch {
    // Not JSON: refused below.
  }
  return 'invalid';
}

async function tip(git: UpstreamGit): Promise<string | null> {
  const r = await git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], true);
  const sha = r.out.trim();
  return r.code === 0 && SHA.test(sha) ? sha : null;
}

/**
 * The author of the workspace HEAD, when it is a player identity. The keeper's gate requires every
 * new commit's author and committer to be the player, so a rebase keeps that identity.
 */
async function playerIdentity(git: UpstreamGit): Promise<{ name: string; email: string } | null> {
  const r = await git(['log', '-1', '--format=%an%x00%ae'], true);
  const [name = '', email = ''] = r.out.trim().split('\0');
  return r.code === 0 && name.startsWith('player-') ? { name, email } : null;
}

async function isAncestor(git: UpstreamGit, ancestor: string, of: string): Promise<boolean> {
  return (await git(['merge-base', '--is-ancestor', ancestor, of], false)).code === 0;
}

/** Puts the workspace back at `head`, aborting an unfinished rebase or merge first. */
async function undo(git: UpstreamGit, head: string): Promise<void> {
  await git(['rebase', '--abort'], false);
  await git(['merge', '--abort'], false);
  await git(['reset', '--hard', '--quiet', head], false);
}

/**
 * Applies the keeper's bundle to the workspace as the player, between runs only. A fast-forward
 * when the workspace has no commits of its own; otherwise its memory-only commits are rebased onto
 * the upstream head. Nothing is merged by hand: a refusal aborts and reports `failed: <code>`.
 */
export async function syncUpstream(
  settings: Settings,
  git: UpstreamGit,
  log: (text: string) => void,
): Promise<SyncReport> {
  const m = readManifest(settings.keeperDir);
  if (m === null) return { result: 'none', head: null };
  const head = await tip(git);
  const fail = (code: string): SyncReport => {
    log(`upstream refused: ${code}`);
    return { result: `failed: ${code}`, head };
  };
  if (head === null) return fail('head');
  if (m === 'invalid') return fail('manifest');
  if (await isAncestor(git, m.head, head)) return { result: 'none', head };
  const status = await git(['status', '--porcelain'], true);
  if (status.code !== 0) return fail('status');
  if (status.out.trim() !== '') {
    log('upstream deferred: the workspace has uncommitted changes');
    return { result: 'none', head };
  }
  const bundle = join(settings.keeperDir, 'upstream.bundle');
  const fetched = await git(
    ['fetch', '--no-tags', '--no-recurse-submodules', bundle, m.head],
    false,
  );
  if (fetched.code !== 0) return fail('fetch');
  const ahead = !(await isAncestor(git, head, m.head));
  if (
    ahead &&
    !((await isAncestor(git, m.base, head)) && (await isAncestor(git, m.base, m.head)))
  ) {
    return fail('base');
  }
  let step = ['merge', '--ff-only', 'FETCH_HEAD'];
  let env: Record<string, string> | undefined;
  if (ahead) {
    const who = await playerIdentity(git);
    if (who === null) return fail('identity');
    step = [
      '-c',
      `user.name=${who.name}`,
      '-c',
      `user.email=${who.email}`,
      'rebase',
      '--onto',
      m.head,
      m.base,
    ];
    env = { GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email };
  }
  if ((await git(step, false, env)).code !== 0) {
    await undo(git, head);
    return fail(ahead ? 'rebase' : 'merge');
  }
  const after = await tip(git);
  if (after === null) {
    await undo(git, head);
    return fail('head');
  }
  log(`upstream applied head=${after}`);
  return { result: 'applied', head: after };
}
