import type { KeeperConfig } from './config.ts';
import type { GitResult } from './git.ts';
import { hardenedArgs, hardenedEnv } from './git.ts';
import type { KeeperDeps } from './keeper.ts';
import type { Transport } from './transport.ts';

const SHA = /^[0-9a-f]{40}$/;

/** A step that stops the cycle on purpose. The message is a short fixed code. */
export class Refusal extends Error {}

// Runs one git call in the private clone; the extra `-c` settings come before the subcommand.
export function call(
  cfg: KeeperConfig,
  deps: KeeperDeps,
  args: readonly string[],
  opts: { config?: readonly string[]; env?: NodeJS.ProcessEnv } = {},
): GitResult {
  const configArgs = (opts.config ?? []).flatMap((setting) => ['-c', setting]);
  return deps.git(
    cfg.clone,
    [...hardenedArgs(cfg.hooksDir), ...configArgs, ...args],
    hardenedEnv(opts.env),
  );
}

// The trimmed standard output of a call that must succeed; any other exit throws `reason`.
export function mustSucceed(result: GitResult, reason: string): string {
  if (result.status !== 0) throw new Refusal(reason);
  return result.stdout.trim();
}

// Fetches the remote branch into the private clone (FETCH_HEAD only; no ref is written) and
// returns the commit it names. Read only: the remote is never pushed to here.
export function fetchRemote(cfg: KeeperConfig, deps: KeeperDeps): string {
  const { transport } = deps;
  const fetchOpts: { config: Transport['config']; env: Transport['env'] } = {
    config: transport.config,
    env: transport.env,
  };
  mustSucceed(
    call(
      cfg,
      deps,
      [
        'fetch',
        '--no-tags',
        '--no-recurse-submodules',
        '--',
        transport.url,
        `refs/heads/${cfg.branch}`,
      ],
      fetchOpts,
    ),
    'remote_fetch_failed',
  );
  const head = mustSucceed(
    call(cfg, deps, ['rev-parse', '--verify', '--quiet', 'FETCH_HEAD^{commit}']),
    'remote_fetch_failed',
  );
  if (!SHA.test(head)) throw new Refusal('remote_fetch_failed');
  return head;
}
