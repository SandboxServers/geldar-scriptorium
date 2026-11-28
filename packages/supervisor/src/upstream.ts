import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_BUNDLE_BYTES } from '@geldar/scriptorium-verify';
import type { Settings } from './settings.ts';

/** The keeper's bundle file name in its state folder. */
const BUNDLE = 'upstream.bundle';

/** The file the apply's git calls write their stderr to (the supervisor names it; each call truncates it). */
export const UPSTREAM_ERR = 'upstream.err';

/** The seconds a refused fetch, merge or rebase waits before its one retry. */
export const RETRY_SECS = 20;

/** The longest git stderr that goes into the log, in characters. */
const STDERR_CAP = 1024;

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

/** An apply step (fetch, merge or rebase) that refused and was undone: `refused` names the step. */
interface Refused {
  refused: 'fetch' | 'merge' | 'rebase';
}

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

/** The keeper's bundle, read whole. A symlink, a non-regular file or one over the cap is null. */
function readBundle(source: string): Buffer | null {
  const link = lstatSync(source, { throwIfNoEntry: false });
  if (link === undefined || !link.isFile()) return null;
  let fd: number | undefined;
  try {
    fd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MAX_BUNDLE_BYTES) return null;
    const body = Buffer.alloc(st.size);
    readSync(fd, body, 0, st.size, 0);
    return body;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Fetches `head` from a copy of the keeper's bundle that the player user can read (the keeper's own
 * copy is readable by the supervisor alone). The copy sits in a fresh folder that is removed whatever
 * the outcome. Returns the git exit code, or null when the bundle was refused and nothing ran.
 */
async function fetchFromCopy(
  bundle: string,
  head: string,
  git: UpstreamGit,
): Promise<number | null> {
  const body = readBundle(bundle);
  if (body === null) return null;
  const dir = mkdtempSync(join(tmpdir(), 'geldar-bundle-'));
  const file = join(dir, BUNDLE);
  try {
    chmodSync(dir, 0o755);
    writeFileSync(file, body, { flag: 'wx', mode: 0o644 });
    chmodSync(file, 0o644);
    return (await git(['fetch', '--no-tags', '--no-recurse-submodules', file, head], false)).code;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The apply's stderr file as the last git call left it (read before an undo overwrites it). */
function readStderr(settings: Settings): string {
  try {
    return readFileSync(join(settings.stateDir, UPSTREAM_ERR), 'utf8');
  } catch {
    return '';
  }
}

/**
 * git's stderr as one log line: newlines become spaces and control characters go, then the text is
 * cut to STDERR_CAP characters. Nothing left reads as `(no output)`.
 */
function oneLine(text: string): string {
  const clean = [...text.replace(/\r\n|\r|\n/g, ' ')]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join('')
    .trim();
  if (clean === '') return '(no output)';
  return [...clean].slice(0, STDERR_CAP).join('');
}

/** A refusal that is not retried: logged, and the result is `failed: <code>`. */
function refuse(log: (text: string) => void, code: string, head: string | null): SyncReport {
  log(`upstream refused: ${code}`);
  return { result: `failed: ${code}`, head };
}

/**
 * A fetch, merge or rebase that refused: the stderr line is logged (after the undo, which a merge
 * or rebase needs; the stderr is read before it, since the undo's own git calls overwrite the file).
 */
async function stepRefused(
  settings: Settings,
  git: UpstreamGit,
  log: (text: string) => void,
  step: Refused['refused'],
  head: string,
): Promise<Refused> {
  const stderr = readStderr(settings);
  if (step !== 'fetch') await undo(git, head);
  log(`upstream git: ${oneLine(stderr)}`);
  return { refused: step };
}

/**
 * One attempt at the apply, against a clean workspace. Its refusals of the manifest's terms are
 * deterministic and come back as a report; a fetch, merge or rebase that refused comes back as
 * `Refused` (already undone and logged), so the caller may retry it.
 */
async function applyOnce(
  settings: Settings,
  git: UpstreamGit,
  log: (text: string) => void,
  m: Manifest,
  head: string,
): Promise<SyncReport | Refused> {
  const status = await git(['status', '--porcelain'], true);
  if (status.code !== 0) return refuse(log, 'status', head);
  if (status.out.trim() !== '') {
    log('upstream deferred: the workspace has uncommitted changes');
    return { result: 'none', head };
  }
  const fetched = await fetchFromCopy(join(settings.keeperDir, BUNDLE), m.head, git);
  if (fetched === null) return refuse(log, 'bundle', head);
  if (fetched !== 0) return stepRefused(settings, git, log, 'fetch', head);
  const ahead = !(await isAncestor(git, head, m.head));
  if (
    ahead &&
    !((await isAncestor(git, m.base, head)) && (await isAncestor(git, m.base, m.head)))
  ) {
    return refuse(log, 'base', head);
  }
  let step = ['merge', '--ff-only', 'FETCH_HEAD'];
  let env: Record<string, string> | undefined;
  if (ahead) {
    const who = await playerIdentity(git);
    if (who === null) return refuse(log, 'identity', head);
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
    return stepRefused(settings, git, log, ahead ? 'rebase' : 'merge', head);
  }
  const after = await tip(git);
  if (after === null) {
    await undo(git, head);
    return refuse(log, 'head', head);
  }
  log(`upstream applied head=${after}`);
  return { result: 'applied', head: after };
}

/**
 * Applies the keeper's bundle to the workspace as the player, between runs only. A fast-forward
 * when the workspace has no commits of its own; otherwise its memory-only commits are rebased onto
 * the upstream head. Nothing is merged by hand. A fetch, merge or rebase that refuses is undone and
 * retried once after `RETRY_SECS` (through `sleep`; none by default); a second refusal reports
 * `failed: <code>`. The manifest, head, base and identity refusals are never retried.
 */
export async function syncUpstream(
  settings: Settings,
  git: UpstreamGit,
  log: (text: string) => void,
  sleep: (seconds: number) => Promise<void> = async () => {},
): Promise<SyncReport> {
  const m = readManifest(settings.keeperDir);
  if (m === null) return { result: 'none', head: null };
  const head = await tip(git);
  if (head === null) return refuse(log, 'head', head);
  if (m === 'invalid') return refuse(log, 'manifest', head);
  if (await isAncestor(git, m.head, head)) return { result: 'none', head };
  let attempt = await applyOnce(settings, git, log, m, head);
  if (!('refused' in attempt)) return attempt;
  await sleep(RETRY_SECS);
  attempt = await applyOnce(settings, git, log, m, head);
  if ('refused' in attempt) return refuse(log, attempt.refused, head);
  return attempt;
}
