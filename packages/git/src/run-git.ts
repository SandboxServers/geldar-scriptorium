import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitIdentity } from '@geldar/scriptorium-path-rule';

export const NULL_DEVICE: string = process.platform === 'win32' ? 'NUL' : '/dev/null';
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
// A stalled git (for example on a huge or hung tree) is killed after this long.
export const GIT_TIMEOUT_MS = 60_000;

export class GitError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GitError';
    this.code = code;
  }
}

const ALLOWED_SUBCOMMANDS = new Set([
  'rev-parse',
  'read-tree',
  'ls-tree',
  'hash-object',
  'update-index',
  'diff',
  'write-tree',
  'commit-tree',
  'update-ref',
]);

let homeDir: string | undefined;

// One empty folder per process, used as HOME, XDG_CONFIG_HOME and USERPROFILE.
function emptyHome(): string {
  if (homeDir === undefined) {
    const dir = mkdtempSync(join(tmpdir(), 'geldar-git-home-'));
    homeDir = dir;
    process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  }
  return homeDir;
}

function refuse(): never {
  throw new GitError('git_subcommand_not_allowed', 'git subcommand not allowed');
}

function checkArgs(args: readonly string[]): void {
  const sub = args[0];
  if (sub === undefined || !ALLOWED_SUBCOMMANDS.has(sub)) refuse();
  if (sub === 'hash-object') {
    const pathOption = args.some((arg) => arg.startsWith('--path'));
    if (!args.includes('--no-filters') || !args.includes('--stdin-paths') || pathOption) refuse();
  }
  if (sub === 'diff' && !args.includes('--cached')) refuse();
}

export function gitOptions(identity?: GitIdentity): string[] {
  const options = [
    // refs/replace/* would otherwise redirect read-tree, ls-tree and diff to a crafted commit.
    '--no-replace-objects',
    `--attr-source=${EMPTY_TREE}`,
    '-c',
    `core.hooksPath=${NULL_DEVICE}`,
    '-c',
    `core.attributesFile=${NULL_DEVICE}`,
    '-c',
    'core.fileMode=false',
    '-c',
    'core.autocrlf=false',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'commit.gpgsign=false',
    '--literal-pathspecs',
  ];
  if (identity) {
    options.push('-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`);
  }
  return options;
}

export function gitEnv(identity?: GitIdentity): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith('GIT_')) env[key] = value;
  }
  const home = emptyHome();
  env.GIT_CONFIG_GLOBAL = NULL_DEVICE;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_ATTR_NOSYSTEM = '1';
  env.GIT_NO_REPLACE_OBJECTS = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  env.HOME = home;
  env.XDG_CONFIG_HOME = home;
  env.USERPROFILE = home;
  if (identity) {
    env.GIT_AUTHOR_NAME = identity.name;
    env.GIT_AUTHOR_EMAIL = identity.email;
    env.GIT_COMMITTER_NAME = identity.name;
    env.GIT_COMMITTER_EMAIL = identity.email;
  }
  return env;
}

export function runGit(
  root: string,
  args: readonly string[],
  identity?: GitIdentity,
  input?: string,
): string {
  checkArgs(args);
  try {
    return execFileSync('git', [...gitOptions(identity), ...args], {
      cwd: root,
      env: gitEnv(identity),
      ...(input === undefined ? {} : { input }),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
      timeout: GIT_TIMEOUT_MS,
    });
  } catch (err) {
    const failure = err as { code?: unknown; killed?: unknown; stderr?: unknown };
    if (failure.code === 'ETIMEDOUT' || failure.killed === true) {
      throw new GitError('git_failed', `git timed out after ${GIT_TIMEOUT_MS} ms`);
    }
    const stderr = String(failure.stderr ?? '');
    const first = stderr.split(/\r?\n/)[0] ?? '';
    throw new GitError('git_failed', first.length > 0 ? first : 'git failed');
  }
}
