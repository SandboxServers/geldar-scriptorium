import { chmodSync, existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_BUNDLE_BYTES } from '@geldar/scriptorium-verify';
import { call, fetchRemote, mustSucceed, Refusal } from './clone.ts';
import type { KeeperConfig } from './config.ts';
import type { KeeperDeps } from './keeper.ts';
import { readLastPushed, removeIfPresent, writeAtomic } from './state.ts';
import { countUpstream, inspectUpstream } from './upstream-gate.ts';

/** What the upstream step found: the head on offer (null for none) and a short fixed result. */
export interface UpstreamOutcome {
  head: string | null;
  result: string;
}

/** The offer the supervisor reads from the keeper's state folder (SC-167). */
export const BUNDLE = 'upstream.bundle';
export const MANIFEST = 'upstream.json';

const SHA = /^[0-9a-f]{40}$/;

// Removes the offer. Done before a new one is written and whenever the offer is no longer valid.
function clearOffer(cfg: KeeperConfig): void {
  for (const name of [MANIFEST, BUNDLE, `${BUNDLE}.tmp`]) {
    removeIfPresent(join(cfg.state, name));
  }
}

function refused(cfg: KeeperConfig, code: string): UpstreamOutcome {
  clearOffer(cfg);
  return { head: null, result: `refused: ${code}` };
}

// True when the offer on disk already covers this base and head, so nothing is rebuilt.
function alreadyOffered(cfg: KeeperConfig, base: string, head: string): boolean {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(cfg.state, MANIFEST), 'utf8'));
    if (typeof manifest !== 'object' || manifest === null) return false;
    const { head: offered, base: from } = manifest as Record<string, unknown>;
    return offered === head && from === base && existsSync(join(cfg.state, BUNDLE));
  } catch {
    return false;
  }
}

// Writes the bundle of base..head and then the manifest. The bundle is built under a temporary
// name and renamed into place; the manifest is written last, so it never names a missing bundle.
function offer(cfg: KeeperConfig, deps: KeeperDeps, base: string, head: string): UpstreamOutcome {
  clearOffer(cfg);
  const tmp = join(cfg.state, `${BUNDLE}.tmp`);
  // The bundle holds one ref, the branch, at the upstream head, and only the commits after base.
  mustSucceed(call(cfg, deps, ['update-ref', `refs/heads/${cfg.branch}`, head]), 'upstream_error');
  mustSucceed(
    call(cfg, deps, ['bundle', 'create', '-q', tmp, `refs/heads/${cfg.branch}`, `^${base}`]),
    'upstream_error',
  );
  if (statSync(tmp).size > MAX_BUNDLE_BYTES) throw new Refusal('too_large');
  chmodSync(tmp, 0o644);
  renameSync(tmp, join(cfg.state, BUNDLE));
  const manifest = {
    head,
    base,
    commits: countUpstream(cfg, deps, base, head),
    created_utc: deps.now().toISOString(),
  };
  writeAtomic(join(cfg.state, MANIFEST), `${JSON.stringify(manifest)}\n`);
  return { head, result: 'offered' };
}

// True when `ancestor` is reachable from `tip`. Only exit 0 and 1 are answers; anything else is an
// error, never a no.
function isAncestor(cfg: KeeperConfig, deps: KeeperDeps, ancestor: string, tip: string): boolean {
  const result = call(cfg, deps, ['merge-base', '--is-ancestor', ancestor, tip]);
  if (result.status !== 0 && result.status !== 1) throw new Refusal('upstream_error');
  return result.status === 0;
}

// The best common ancestor of the workspace tip and the remote tip, or null when they share none.
function mergeBase(cfg: KeeperConfig, deps: KeeperDeps, tip: string, head: string): string | null {
  const result = call(cfg, deps, ['merge-base', tip, head]);
  if (result.status === 1) return null;
  const base = result.stdout.trim();
  if (result.status !== 0 || !SHA.test(base)) throw new Refusal('upstream_error');
  return base;
}

// One upstream check, run each cycle after the workspace fetch and before any push. Read only on
// the remote; it never throws and never sets HELD, because an upstream refusal is not a push
// refusal. The base is the merge-base of the workspace tip and the remote tip, so a player that
// has never pushed is offered too. A remote that lost the last pushed head is diverged.
export async function fetchUpstream(
  cfg: KeeperConfig,
  deps: KeeperDeps,
  tip: string,
): Promise<UpstreamOutcome> {
  const last = readLastPushed(cfg.state);
  try {
    const head = fetchRemote(cfg, deps);
    // The workspace already holds the remote tip: nothing is ahead, so any old offer is stale.
    if (isAncestor(cfg, deps, head, tip)) {
      clearOffer(cfg);
      return { head: null, result: 'none' };
    }
    if (last !== null && !isAncestor(cfg, deps, last, head)) {
      clearOffer(cfg);
      return { head: null, result: 'diverged' };
    }
    const base = mergeBase(cfg, deps, tip, head);
    if (base === null) {
      clearOffer(cfg);
      return { head: null, result: 'diverged' };
    }
    if (alreadyOffered(cfg, base, head)) return { head, result: 'offered' };
    const code = inspectUpstream(cfg, deps, base, head);
    if (code !== null) return refused(cfg, code);
    return offer(cfg, deps, base, head);
  } catch (error) {
    return refused(cfg, error instanceof Refusal ? error.message : 'upstream_error');
  }
}
