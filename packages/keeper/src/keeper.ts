import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verify } from '@geldar/scriptorium-verify';
import { call, fetchRemote, mustSucceed, Refusal } from './clone.ts';
import type { KeeperConfig } from './config.ts';
import type { GitRunner } from './git.ts';
import { safeDirectoryConfig } from './git.ts';
import {
  ensureState,
  isHeld,
  readLastPushed,
  writeHeld,
  writeLastPushed,
  writeStatus,
} from './state.ts';
import type { Transport } from './transport.ts';
import type { UpstreamOutcome } from './upstream.ts';
import { fetchUpstream } from './upstream.ts';

export interface KeeperDeps {
  git: GitRunner;
  transport: Transport;
  log: (line: string) => void;
  now: () => Date;
}

export type RunOutcome = 'pushed' | 'unchanged' | 'held';

export interface RunResult {
  outcome: RunOutcome;
  /** A short fixed code; present for 'held'. */
  reason?: string;
}

const SHA = /^[0-9a-f]{40}$/;

// Reads only objects and the one branch from the workspace, as a plain path, from inside the
// private clone. Nothing in the workspace's .git/config or hooks is ever consulted by us: the
// only git that touches it is the upload-pack it spawns, and that runs no hook.
function fetchWorkspace(cfg: KeeperConfig, deps: KeeperDeps): string {
  mustSucceed(
    call(
      cfg,
      deps,
      [
        'fetch',
        '--no-tags',
        '--no-recurse-submodules',
        '--',
        cfg.workspace,
        `refs/heads/${cfg.branch}`,
      ],
      {
        config: ['protocol.file.allow=user'],
        // The workspace belongs to the player user: list it (and its .git) as a safe directory
        // through a config file, which the upload-pack child inherits; a -c setting is not passed on.
        env: { GIT_CONFIG_GLOBAL: safeDirectoryConfig([cfg.workspace, `${cfg.workspace}/.git`]) },
      },
    ),
    'workspace_fetch_failed',
  );
  const tip = mustSucceed(
    call(cfg, deps, ['rev-parse', '--verify', '--quiet', 'FETCH_HEAD^{commit}']),
    'workspace_fetch_failed',
  );
  if (!SHA.test(tip)) throw new Refusal('workspace_fetch_failed');
  return tip;
}

function gate(cfg: KeeperConfig, deps: KeeperDeps, tip: string, remoteHead: string): void {
  const scratch = mkdtempSync(join(tmpdir(), 'keeper-bundle-'));
  try {
    mustSucceed(call(cfg, deps, ['update-ref', `refs/heads/${cfg.branch}`, tip]), 'clone_failed');
    const bundle = join(scratch, 'workspace.bundle');
    mustSucceed(
      call(cfg, deps, ['bundle', 'create', '-q', bundle, `refs/heads/${cfg.branch}`]),
      'bundle_failed',
    );
    const verdict = verify({
      bundle,
      start: remoteHead,
      branch: cfg.branch,
      mode: 'play',
      playerId: cfg.playerId,
    });
    if (!verdict.ok) throw new Refusal(`gate: ${verdict.reasons.join(',')}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Fast-forward only: the refspec has no plus sign and there is no force option, so a remote that
// moved or a history that was rewritten is refused by git itself as well as by the gate.
function push(cfg: KeeperConfig, deps: KeeperDeps, tip: string): void {
  const { transport } = deps;
  mustSucceed(
    call(
      cfg,
      deps,
      [
        'push',
        '--no-verify',
        '--no-recurse-submodules',
        '--',
        transport.url,
        `${tip}:refs/heads/${cfg.branch}`,
      ],
      {
        config: transport.config,
        env: transport.env,
      },
    ),
    'push_rejected',
  );
  const listed = mustSucceed(
    call(cfg, deps, ['ls-remote', '--', transport.url, `refs/heads/${cfg.branch}`], {
      config: transport.config,
      env: transport.env,
    }),
    'remote_fetch_failed',
  );
  if (listed.split(/\s+/)[0] !== tip) throw new Refusal('hash_mismatch');
}

function steps(cfg: KeeperConfig, deps: KeeperDeps): RunOutcome {
  mkdirSync(cfg.clone, { recursive: true });
  mustSucceed(call(cfg, deps, ['init', '--bare', '-q', '-b', cfg.branch, '.']), 'clone_failed');
  const tip = fetchWorkspace(cfg, deps);
  if (tip === readLastPushed(cfg.state)) return 'unchanged';
  const remoteHead = fetchRemote(cfg, deps);
  if (remoteHead === tip) {
    writeLastPushed(cfg.state, tip);
    return 'unchanged';
  }
  gate(cfg, deps, tip, remoteHead);
  push(cfg, deps, tip);
  writeLastPushed(cfg.state, tip);
  return 'pushed';
}

// One keeper cycle. While HELD exists nothing is fetched and nothing is pushed. Any refusal or
// failure writes HELD with a short fixed reason; nothing is retried until a person removes it.
// The upstream check runs first; its refusals are recorded in status.json and never set HELD.
export async function runOnce(cfg: KeeperConfig, deps: KeeperDeps): Promise<RunResult> {
  ensureState(cfg.state);
  let result: RunResult;
  let upstream: UpstreamOutcome = { head: null, result: 'not_checked' };
  if (isHeld(cfg.state)) {
    result = { outcome: 'held', reason: 'already_held' };
  } else {
    try {
      upstream = await fetchUpstream(cfg, deps);
      result = { outcome: steps(cfg, deps) };
    } catch (error) {
      const reason = error instanceof Refusal ? error.message : 'keeper_error';
      writeHeld(cfg.state, reason);
      result = { outcome: 'held', reason };
    }
  }
  writeStatus(cfg.state, {
    last_run_utc: deps.now().toISOString(),
    last_result:
      result.reason === undefined ? result.outcome : `${result.outcome}: ${result.reason}`,
    last_pushed_head: readLastPushed(cfg.state),
    upstream_head: upstream.head,
    upstream_result: upstream.result,
    interval_seconds: cfg.intervalSeconds,
    held: isHeld(cfg.state),
  });
  deps.log(`keeper: ${result.outcome}${result.reason === undefined ? '' : ` (${result.reason})`}`);
  return result;
}
