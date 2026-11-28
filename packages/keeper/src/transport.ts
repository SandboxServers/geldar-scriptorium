import type { KeeperConfig } from './config.ts';

/** How the keeper reaches the remote: the URL, extra environment and extra `-c` settings. */
export interface Transport {
  url: string;
  env: NodeJS.ProcessEnv;
  config: string[];
}

// Quotes one word for the sh -c that git runs GIT_SSH_COMMAND through.
function shellWord(word: string): string {
  return `'${word.replaceAll("'", "'\\''")}'`;
}

// The production transport: SSH with the deploy key, a pinned host key file and an HTTP CONNECT
// helper as ProxyCommand. The key is named by path only; it is never read here.
export function sshTransport(cfg: KeeperConfig): Transport {
  const sshCommand = [
    'ssh',
    '-i',
    shellWord(cfg.key),
    '-o IdentitiesOnly=yes',
    '-o StrictHostKeyChecking=yes',
    '-o',
    shellWord(`UserKnownHostsFile=${cfg.knownHosts}`),
    '-o BatchMode=yes',
    '-o',
    shellWord('ProxyCommand=geldar-keeper-connect %h %p'),
  ].join(' ');
  return {
    url: cfg.remote,
    env: { GIT_SSH_COMMAND: sshCommand, GELDAR_KEEPER_PROXY: cfg.proxy },
    config: ['protocol.file.allow=never'],
  };
}

/** A transport with no SSH: the remote is a path or URL git can read directly (tests). */
export function directTransport(url: string): Transport {
  return { url, env: {}, config: [] };
}
