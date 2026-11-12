import { isAbsolute } from 'node:path';

// The contract with the compose project (decision 64): every name below is fixed there.
export interface KeeperConfig {
  /** The repository to push to (SSH URL; a local path in tests). */
  remote: string;
  /** The deploy key file (a Docker secret). Only its path is ever used, never its content. */
  key: string;
  intervalSeconds: number;
  /** The player's repository checkout, mounted read-only. Untrusted. */
  workspace: string;
  /** The keeper's private bare clone. */
  clone: string;
  /** The keeper's own state folder: status.json, HELD, last-pushed-head. */
  state: string;
  /** The supervisor's state folder, read-only: only the existence of checkpoint-request is used. */
  supervisorState: string;
  branch: string;
  playerId: string;
  proxy: string;
  knownHosts: string;
  /** An empty folder the keeper owns, used as core.hooksPath. */
  hooksDir: string;
}

export const DEFAULT_INTERVAL_SECONDS = 600;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/;

function absolute(name: string, value: string): string {
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return value;
}

// Throws on a missing or malformed value; the message names the variable, never its value.
export function loadConfig(env: NodeJS.ProcessEnv, hooksDir: string): KeeperConfig {
  const need = (name: string): string => {
    const value = env[name];
    if (value === undefined || value === '') throw new Error(`${name} is not set`);
    return value;
  };
  const intervalText = env.GELDAR_KEEPER_INTERVAL ?? String(DEFAULT_INTERVAL_SECONDS);
  const intervalSeconds = Number(intervalText);
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1) {
    throw new Error('GELDAR_KEEPER_INTERVAL must be a whole number of seconds');
  }
  const branch = env.GELDAR_KEEPER_BRANCH ?? 'main';
  if (!BRANCH.test(branch) || branch.includes('..')) throw new Error('GELDAR_KEEPER_BRANCH is bad');
  return {
    remote: need('GELDAR_KEEPER_REMOTE'),
    key: absolute('GELDAR_KEEPER_KEY', env.GELDAR_KEEPER_KEY ?? '/run/secrets/geldar-deploy-key'),
    intervalSeconds,
    workspace: absolute('GELDAR_KEEPER_WORKSPACE', env.GELDAR_KEEPER_WORKSPACE ?? '/workspace'),
    clone: absolute('GELDAR_KEEPER_CLONE', env.GELDAR_KEEPER_CLONE ?? '/clone'),
    state: absolute('GELDAR_KEEPER_STATE', env.GELDAR_KEEPER_STATE ?? '/keeper-state'),
    supervisorState: absolute(
      'GELDAR_KEEPER_SUPERVISOR_STATE',
      env.GELDAR_KEEPER_SUPERVISOR_STATE ?? '/supervisor-state',
    ),
    branch,
    playerId: need('GELDAR_KEEPER_PLAYER_ID'),
    proxy: env.GELDAR_KEEPER_PROXY ?? 'proxy-keeper:3128',
    knownHosts: absolute(
      'GELDAR_KEEPER_KNOWN_HOSTS',
      env.GELDAR_KEEPER_KNOWN_HOSTS ?? '/etc/geldar/keeper-known-hosts',
    ),
    hooksDir,
  };
}
