import { describe, expect, it } from 'vitest';
import { REASONS, verdict } from './reasons.ts';

describe('verdict', () => {
  it('deduplicates and orders reasons by REASONS', () => {
    expect(verdict(['path_not_allowed', 'bundle_too_large', 'path_not_allowed'])).toEqual({
      ok: false,
      reasons: ['bundle_too_large', 'path_not_allowed'],
    });
  });

  it('is ok when nothing was found', () => {
    expect(verdict([])).toEqual({ ok: true, reasons: [] });
  });
});

describe('REASONS', () => {
  it('lists the stable identifiers in the contract order', () => {
    expect([...REASONS]).toEqual([
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
    ]);
  });

  it('puts too_many_commits after bundle_fetch_failed', () => {
    expect(REASONS.indexOf('too_many_commits')).toBeGreaterThan(
      REASONS.indexOf('bundle_fetch_failed'),
    );
  });
});
