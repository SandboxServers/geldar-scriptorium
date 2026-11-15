import { describe, expect, it } from 'vitest';
import { acceptedReply, OWN_ACT_LINE, readConfig } from './run.ts';

describe('readConfig numeric env', () => {
  it('uses the contract defaults for missing, blank and non-numeric values, never NaN', () => {
    const cfg = readConfig({
      GELDAR_INSTINCT_FAILURE_CAP: 'four',
      GELDAR_INSTINCT_MAX_PICKS: '  ',
      GELDAR_INSTINCT_THINK_P: 'NaN',
    });
    expect(cfg.failureCap).toBe(4);
    expect(cfg.maxPicks).toBe(3);
    expect(cfg.thinkP).toBe(0.25);
  });

  it('reads a valid number', () => {
    expect(readConfig({ GELDAR_INSTINCT_THINK_P: '0.5' }).thinkP).toBe(0.5);
  });
});

describe('acceptedReply', () => {
  it('is true for a non-empty accepted array', () => {
    expect(acceptedReply('{"accepted":[0],"rejected":[],"budget_remaining_thoughts":3}')).toBe(
      true,
    );
  });

  it('is false when accepted is empty, even with rejected lines (send_failed)', () => {
    const reply =
      '{"accepted":[],"rejected":[{"index":0,"reason":"bad_intent"}],"budget_remaining_thoughts":3}';
    expect(acceptedReply(reply)).toBe(false);
  });

  it('is false for plain text, a non-array accepted field, or JSON null', () => {
    expect(acceptedReply('Your act was accepted.')).toBe(false);
    expect(acceptedReply('{"accepted":"0"}')).toBe(false);
    expect(acceptedReply('null')).toBe(false);
  });

  it('gives a fixed own-act sentence', () => {
    expect(OWN_ACT_LINE).toBe('Your act was accepted.');
  });
});
