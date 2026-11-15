import { describe, expect, it } from 'vitest';
import { estimateTokens, outputReserve } from './tokens.ts';

describe('estimateTokens', () => {
  it('counts one token per three bytes, rounding up', () => {
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('a'.repeat(300))).toBe(100);
    expect(estimateTokens('')).toBe(0);
  });

  it('counts UTF-8 bytes, not characters', () => {
    // 150 characters of two bytes each: 300 bytes, so 100 tokens.
    expect(estimateTokens('é'.repeat(150))).toBe(100);
  });
});

describe('outputReserve', () => {
  it('is a quarter of the context, at most 2048 tokens', () => {
    expect(outputReserve(1200)).toBe(300);
    expect(outputReserve(8000)).toBe(2000);
    expect(outputReserve(100_000)).toBe(2048);
  });
});
