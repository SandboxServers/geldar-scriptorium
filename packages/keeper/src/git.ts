import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';

const MAX_BUFFER = 64 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

export interface GitResult {
  status: number;
  stdout: string;
}

/** Runs git in a folder. Injectable so tests can record every call. */
export type GitRunner = (cwd: string, args: readonly string[], env: NodeJS.ProcessEnv) => GitResult;

let emptyHome: string | undefined;

function emptyHomeDir(): string {
  emptyHome ??= mkdtempSync(join(tmpdir(), 'keeper-home-'));
  return emptyHome;
}

// The environment of every git call: no GIT_* variable from outside survives (so GIT_ASKPASS,
// GIT_DIR, GIT_EXEC_PATH and the like are gone), no user or system config is read, no prompt.
export function hardenedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    const upper = name.toUpperCase();
    if (value === undefined || upper.startsWith('GIT_') || upper.endsWith('ASKPASS')) continue;
    env[name] = value;
  }
  const home = emptyHomeDir();
  return {
    ...env,
    GIT_CONFIG_GLOBAL: NULL_DEVICE,
    GIT_CONFIG_SYSTEM: NULL_DEVICE,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    HOME: home,
    XDG_CONFIG_HOME: home,
    USERPROFILE: home,
    ...extra,
  };
}

// The options before every git subcommand. hooksDir is an empty folder the keeper owns.
export function hardenedArgs(hooksDir: string): string[] {
  return [
    '-c',
    `core.hooksPath=${hooksDir}`,
    '-c',
    'core.fsmonitor=false',
    '-c',
    `core.attributesFile=${NULL_DEVICE}`,
    '-c',
    'transfer.fsckObjects=true',
    '-c',
    'fetch.fsckObjects=true',
    '-c',
    'uploadpack.allowAnySHA1InWant=false',
  ];
}

// A non-zero exit is returned, not thrown. Standard error is dropped on purpose: nothing from a
// git failure (a URL, a path) reaches the keeper's logs or the HELD file.
export const runGit: GitRunner = (cwd, args, env) => {
  const result = spawnSync('git', [...args], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    timeout: TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, stdout: result.stdout };
};
