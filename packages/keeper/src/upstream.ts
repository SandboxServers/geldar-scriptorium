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

// One upstream check, run before the workspace fetch of each cycle. Read only on the remote; it
// never throws and never sets HELD, because an upstream refusal is not a push refusal. The base
// is the tip the keeper last pushed: the remote must be a fast-forward of it.
export async function fetchUpstream(cfg: KeeperConfig, deps: KeeperDeps): Promise<UpstreamOutcome> {
  const base = readLastPushed(cfg.state);
  if (base === null) {
    clearOffer(cfg);
    return { head: null, result: 'none' };
  }
  try {
    const head = fetchRemote(cfg, deps);
    if (head === base) {
      clearOffer(cfg);
      return { head: null, result: 'none' };
    }
    const ancestor = call(cfg, deps, ['merge-base', '--is-ancestor', base, head]);
    if (ancestor.status === 1) {
      clearOffer(cfg);
      return { head: null, result: 'diverged' };
    }
    if (ancestor.status !== 0) throw new Refusal('upstream_error');
    if (alreadyOffered(cfg, base, head)) return { head, result: 'offered' };
    const code = inspectUpstream(cfg, deps, base, head);
    if (code !== null) return refused(cfg, code);
    return offer(cfg, deps, base, head);
  } catch (error) {
    return refused(cfg, error instanceof Refusal ? error.message : 'upstream_error');
  }
}
