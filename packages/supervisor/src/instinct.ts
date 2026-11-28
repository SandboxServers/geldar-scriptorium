import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type InstinctResult, parseInstinctResult } from '@geldar/scriptorium-instinct';
import type { Deps } from './deps.ts';
import type { Settings } from './settings.ts';

type Env = Readonly<Record<string, string | undefined>>;

/** Why a waking's instinct step gave no usable result (the `reason` of the error line). */
type ErrorReason = 'exit' | 'timeout' | 'bad_output';

/** The largest result file the supervisor reads (the contract's MAX_RESULT_BYTES). */
const RESULT_MAX_BYTES = 65536;

/** The exit code of a child killed for its timeout (see createExecSelf in deps.ts). */
const TIMEOUT_CODE = 124;

/** The PATH of a child when the supervisor has none (the same default as the model child). */
const SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

/** Names the instinct child takes from the supervisor's environment as they are, when set. */
const PASS_THROUGH = [
  'GELDAR_MCP_URL',
  'GELDAR_MCP_TOKEN',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
];

/**
 * The explicit environment of the `geldar-instinct` child: nothing is inherited beyond these names.
 * It carries no CLAUDE_CODE_OAUTH_TOKEN and no GELDAR_SHEET or sheet name; the model child never
 * gets a GELDAR_INSTINCT name (see childEnv).
 */
export function instinctEnv(settings: Settings, env: Env): Record<string, string> {
  const i = settings.instinct;
  const out: Record<string, string> = {
    PATH: env.PATH ?? SYSTEM_PATH,
    HOME: '/tmp',
    NODE_USE_ENV_PROXY: '1',
    GELDAR_WORKSPACE: settings.workspace,
    GELDAR_INSTINCT_STATE: join(settings.stateDir, 'instinct'),
    GELDAR_HARNESS: settings.harness,
    GELDAR_INSTINCT: 'on',
    GELDAR_INSTINCT_ARM: i.arm,
    GELDAR_INSTINCT_FAILURE_CAP: String(i.failureCap),
    GELDAR_INSTINCT_MAX_PICKS: String(i.maxPicks),
    GELDAR_INSTINCT_THINK_P: String(i.thinkP),
    GELDAR_INSTINCT_ROLLS: i.rolls ? 'on' : 'off',
    GELDAR_INSTINCT_SANITY: i.sanity ? 'on' : 'off',
    GELDAR_INSTINCT_TIMEOUT: String(i.timeoutSecs),
  };
  if (settings.model !== '') out.GELDAR_RUN_MODEL = settings.model;
  for (const name of PASS_THROUGH) {
    const value = env[name];
    if (value !== undefined && value !== '') out[name] = value;
  }
  return out;
}

/** The result a child wrote, or null when it is missing, too large or not a valid result. */
function readResult(file: string): InstinctResult | null {
  try {
    if (statSync(file).size > RESULT_MAX_BYTES) return null;
    return parseInstinctResult(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Logs one error line to instinct.jsonl and returns the plain pass that lets the waking go ahead. */
function passAfterError(
  deps: Deps,
  settings: Settings,
  n: number,
  reason: ErrorReason,
): InstinctResult {
  const line = {
    v: 1,
    ts: deps.now(),
    run: n,
    arm: settings.instinct.arm,
    source: 'instinct',
    kind: 'error',
    reason,
    model_called: true,
  };
  try {
    appendFileSync(join(settings.stateDir, 'instinct.jsonl'), `${JSON.stringify(line)}\n`, {
      mode: 0o600,
    });
  } catch {
    // The audit is best effort: a failed append must not stop the waking.
  }
  return { v: 1, kind: 'pass', reason: 'error', forced: false, rolls: [] };
}

/**
 * Runs `geldar-instinct run` for waking `n` and returns its result. It never throws: a child that
 * exits non-zero, times out or writes no valid result is logged as an error line and the waking
 * runs the model as a plain pass. Call it only when the instinct step is enabled.
 */
export async function runInstinct(
  deps: Deps,
  settings: Settings,
  env: Env,
  n: number,
): Promise<InstinctResult> {
  const dir = join(settings.stateDir, 'instinct');
  const file = join(dir, 'last.json');
  let reason: ErrorReason;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    rmSync(file, { force: true });
    const code = await deps.execSelf({
      file: 'geldar-instinct',
      args: ['run', '--run', String(n)],
      env: instinctEnv(settings, env),
      cwd: settings.stateDir,
      stdoutPath: file,
      timeoutMs: settings.instinct.timeoutSecs * 1000,
    });
    if (code === TIMEOUT_CODE) {
      reason = 'timeout';
    } else if (code !== 0) {
      reason = 'exit';
    } else {
      const result = readResult(file);
      if (result !== null) return result;
      reason = 'bad_output';
    }
  } catch {
    // The child could not be started or the directory is unusable: the same as a failed exit.
    reason = 'exit';
  }
  return passAfterError(deps, settings, n, reason);
}
