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
  /** Empty when no model is set. */
  model: string;
  stateDir: string;
  /** The keeper's read-only state directory (holds HELD). */
  keeperDir: string;
  workspace: string;
  cliHome: string;
  playerUid: number;
  playerGid: number;
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

/** Reads and validates the GELDAR_RUN_* settings (same names, defaults and bounds as run.sh). */
export function readSettings(env: Env): Settings {
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
  const model = env.GELDAR_RUN_MODEL ?? '';
  if (model !== '' && !/^[A-Za-z0-9._:/-]+$/.test(model))
    throw new SettingError('GELDAR_RUN_MODEL');
  if (maxDelay < delayBase) throw new SettingError('GELDAR_RUN_MAX_DELAY');
  return {
    delayBase,
    maxDelay,
    fastSec,
    maxFails,
    maxTurns,
    tidyBytes,
    tidyMaxTurns,
    dailyCap: Number(capText),
    model,
    stateDir: env.GELDAR_SUPERVISOR_STATE ?? '/state/supervisor',
    keeperDir: env.GELDAR_KEEPER_STATE ?? '/keeper-state',
    workspace: env.GELDAR_WORKSPACE ?? '/player',
    cliHome: env.GELDAR_CLI_HOME ?? '/cli-home',
    playerUid: id(env, 'GELDAR_PLAYER_UID'),
    playerGid: id(env, 'GELDAR_PLAYER_GID'),
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
