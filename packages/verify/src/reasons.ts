export const REASONS = [
  'bad_arguments',
  'verify_error',
  'bundle_too_large',
  'bundle_unreadable',
  'bundle_refs_unexpected',
  'bundle_fetch_failed',
  'too_many_commits',
  'not_fast_forward',
  'merge_commit',
  'identity_mismatch',
  'identity_changed',
  'path_not_allowed',
  'symlink_not_allowed',
  'gitlink_not_allowed',
  'executable_not_allowed',
  'bad_mode',
] as const;

export type Reason = (typeof REASONS)[number];

export interface Verdict {
  ok: boolean;
  reasons: Reason[];
}

// Deduplicated, in REASONS order. ok only when nothing was found.
export function verdict(found: Iterable<Reason>): Verdict {
  const set = new Set(found);
  const reasons = REASONS.filter((reason) => set.has(reason));
  return { ok: reasons.length === 0, reasons };
}
