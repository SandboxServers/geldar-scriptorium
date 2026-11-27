import { join } from 'node:path';

/** A refused setting: the process exits 2 and names the variable, never its value. */
export class SettingError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(`The setting ${variable} is not usable.`);
    this.variable = variable;
  }
}

/** Everything the loop reads from the environment, validated once at start. */
export interface Settings {
  harness: 'claude' | 'chatgpt' | 'local';
  delayBase: number;
  maxDelay: number;
  fastSec: number;
  maxFails: number;
  maxTurns: number;
  /** The journal size in bytes above which a tidy session runs first; 0 disables it. */
  tidyBytes: number;
  /** Turns allowed to a tidy session. */
  tidyMaxTurns: number;
  /** Daily cost cap in USD (UTC day), greater than zero. */
  dailyCap: number;
  /** Daily token cap (input plus output, UTC day); 0 disables it. */
  dailyTokenCap: number;
  /** Empty when no model is set. */
  model: string;
  /** The local server's base URL (`local` only; empty otherwise). The API key is never a setting. */
  localBaseUrl: string;
  /** The local model's context window in tokens (`local` only; 0 otherwise). */
  localContextTokens: number;
  /** Whether the local model accepts images (`local` only; false otherwise). */
  localImages: boolean;
  stateDir: string;
  /** The keeper's read-only state directory (holds HELD). */
  keeperDir: string;
  workspace: string;
  cliHome: string;
  playerUid: number;
  playerGid: number;
  /** The instinct step (HC-19): off unless GELDAR_INSTINCT is `on`. */
  instinct: InstinctSettings;
}

/** The GELDAR_INSTINCT_* settings (same names, defaults and bounds as the instinct contract). */
export interface InstinctSettings {
  enabled: boolean;
  arm: string;
  failureCap: number;
  maxPicks: number;
  thinkP: number;
  rolls: boolean;
  sanity: boolean;
  timeoutSecs: number;
}

type Env = Readonly<Record<string, string | undefined>>;

function num(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name] ?? String(fallback);
  if (!/^[0-9]{1,9}$/.test(raw)) throw new SettingError(name);
  const value = Number.parseInt(raw, 10);
  if (value < min || value > max) throw new SettingError(name);
  return value;
}

function id(env: Env, name: string): number {
  const raw = env[name] ?? '1000';
  if (!/^[0-9]{1,9}$/.test(raw)) throw new SettingError(name);
  return Number.parseInt(raw, 10);
}

/** A switch that is `on` or `off`; the default when unset. */
function onOff(env: Env, name: string, fallback: 'on' | 'off'): boolean {
  const raw = env[name] ?? fallback;
  if (raw !== 'on' && raw !== 'off') throw new SettingError(name);
  return raw === 'on';
}

/** The GELDAR_INSTINCT_* fields. `off` by default: with no GELDAR_INSTINCT the step never runs. */
function instinctSettings(env: Env): InstinctSettings {
  const enabled = onOff(env, 'GELDAR_INSTINCT', 'off');
  const arm = env.GELDAR_INSTINCT_ARM ?? 'instinct';
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(arm)) throw new SettingError('GELDAR_INSTINCT_ARM');
  const thinkText = env.GELDAR_INSTINCT_THINK_P ?? '0.25';
  if (!/^(0|1|0\.[0-9]{1,3})$/.test(thinkText)) throw new SettingError('GELDAR_INSTINCT_THINK_P');
  return {
    enabled,
    arm,
    failureCap: num(env, 'GELDAR_INSTINCT_FAILURE_CAP', 4, 1, 20),
    maxPicks: num(env, 'GELDAR_INSTINCT_MAX_PICKS', 3, 1, 20),
    thinkP: Number(thinkText),
    rolls: onOff(env, 'GELDAR_INSTINCT_ROLLS', 'on'),
    sanity: onOff(env, 'GELDAR_INSTINCT_SANITY', 'on'),
    timeoutSecs: num(env, 'GELDAR_INSTINCT_TIMEOUT', 60, 1, 600),
  };
}

/** The local-harness fields: checked only when the harness is `local`, empty or zero otherwise. */
function localSettings(
  env: Env,
  harness: Settings['harness'],
  model: string,
): Pick<Settings, 'localBaseUrl' | 'localContextTokens' | 'localImages'> {
  if (harness !== 'local') return { localBaseUrl: '', localContextTokens: 0, localImages: false };
  if (model === '') throw new SettingError('GELDAR_RUN_MODEL');
  const baseUrl = env.GELDAR_LOCAL_BASE_URL ?? '';
  if (
    baseUrl.length > 200 ||
    !/^https?:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~/-]*)?$/.test(baseUrl)
  )
    throw new SettingError('GELDAR_LOCAL_BASE_URL');
  // Missing is an error here: there is no default context size.
  if (env.GELDAR_LOCAL_CONTEXT_TOKENS === undefined)
    throw new SettingError('GELDAR_LOCAL_CONTEXT_TOKENS');
  const contextTokens = num(env, 'GELDAR_LOCAL_CONTEXT_TOKENS', 0, 1024, 2000000);
  const images = env.GELDAR_LOCAL_IMAGES;
  if (images !== 'true' && images !== 'false') throw new SettingError('GELDAR_LOCAL_IMAGES');
  return {
    localBaseUrl: baseUrl,
    localContextTokens: contextTokens,
    localImages: images === 'true',
  };
}

/** Reads and validates the GELDAR_RUN_* settings (same names, defaults and bounds as run.sh). */
export function readSettings(env: Env): Settings {
  const harness = env.GELDAR_HARNESS ?? 'claude';
  if (harness !== 'claude' && harness !== 'chatgpt' && harness !== 'local')
    throw new SettingError('GELDAR_HARNESS');
  const delayBase = num(env, 'GELDAR_RUN_DELAY', 20, 1, 86400);
  const maxDelay = num(env, 'GELDAR_RUN_MAX_DELAY', 900, 1, 86400);
  const fastSec = num(env, 'GELDAR_RUN_FAST_SEC', 30, 0, 86400);
  const maxFails = num(env, 'GELDAR_RUN_MAX_FAILS', 5, 1, 1000);
  const maxTurns = num(env, 'GELDAR_RUN_MAX_TURNS', 300, 1, 999999);
  const tidyBytes = num(env, 'GELDAR_TIDY_BYTES', 30000, 0, 999999999);
  const tidyMaxTurns = num(env, 'GELDAR_TIDY_MAX_TURNS', 40, 1, 999999);
  const capText = env.GELDAR_RUN_DAILY_CAP_USD ?? '15';
  if (!/^[0-9]{1,6}(\.[0-9]{1,4})?$/.test(capText) || !(Number(capText) > 0)) {
    throw new SettingError('GELDAR_RUN_DAILY_CAP_USD');
  }
  const dailyTokenCap = num(env, 'GELDAR_RUN_DAILY_TOKEN_CAP', 0, 0, 999999999);
  const model = env.GELDAR_RUN_MODEL ?? '';
  if (model !== '' && !/^[A-Za-z0-9._:/-]+$/.test(model))
    throw new SettingError('GELDAR_RUN_MODEL');
  if (maxDelay < delayBase) throw new SettingError('GELDAR_RUN_MAX_DELAY');
  const local = localSettings(env, harness, model);
  return {
    harness,
    delayBase,
    maxDelay,
    fastSec,
    maxFails,
    maxTurns,
    tidyBytes,
    tidyMaxTurns,
    dailyCap: Number(capText),
    dailyTokenCap,
    model,
    ...local,
    stateDir: env.GELDAR_SUPERVISOR_STATE ?? '/state/supervisor',
    keeperDir: env.GELDAR_KEEPER_STATE ?? '/keeper-state',
    workspace: env.GELDAR_WORKSPACE ?? '/player',
    cliHome: env.GELDAR_CLI_HOME ?? '/cli-home',
    playerUid: id(env, 'GELDAR_PLAYER_UID'),
    playerGid: id(env, 'GELDAR_PLAYER_GID'),
    instinct: instinctSettings(env),
  };
}

/** The path of a file in the supervisor state directory. */
export function statePath(settings: Settings, name: string): string {
  return join(settings.stateDir, name);
}

/** Where the keeper's HELD marker lives. */
export function heldPath(settings: Settings): string {
  return join(settings.keeperDir, 'HELD');
}
