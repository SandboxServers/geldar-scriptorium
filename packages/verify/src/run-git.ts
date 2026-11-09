import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The null device for git config: NUL on Windows, /dev/null elsewhere.
// Do not use os.devNull here: on Windows it is \\.\nul, which git rejects.
export const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';

const MAX_BUFFER = 64 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

let emptyHome: string | undefined;

// One empty folder per process, used as HOME, XDG_CONFIG_HOME and USERPROFILE.
// Its prefix does not start with geldar-verify-, so it never looks like a scratch folder.
function emptyHomeDir(): string {
  if (emptyHome === undefined) {
    const dir = mkdtempSync(join(tmpdir(), 'verify-home-'));
    emptyHome = dir;
    process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  }
  return emptyHome;
}

export function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.toUpperCase().startsWith('GIT_')) continue;
    env[key] = value;
  }
  const home = emptyHomeDir();
  return {
    ...env,
    GIT_CONFIG_GLOBAL: NULL_DEVICE,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    HOME: home,
    XDG_CONFIG_HOME: home,
    USERPROFILE: home,
  };
}

const FIXED = ['-c', `core.hooksPath=${NULL_DEVICE}`, '-c', `core.attributesFile=${NULL_DEVICE}`];

// A non-zero exit is returned, not thrown. It throws when git cannot start, and when
// spawnSync reports an error (a timeout, or a stdout overflow past maxBuffer).
export function git(repo: string, args: readonly string[]): { status: number; stdout: string } {
  const result = spawnSync('git', [...FIXED, ...args], {
    cwd: repo,
    env: gitEnv(),
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    timeout: TIMEOUT_MS,
  });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, stdout: result.stdout };
}
