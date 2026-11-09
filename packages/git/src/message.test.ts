import { describe, expect, it } from 'vitest';
import { sanitizeMessage } from './message.ts';

describe('sanitizeMessage', () => {
  it('turns escapes and newlines into one plain line', () => {
    expect(sanitizeMessage('a\u001b[31m\nb')).toBe('a[31m b');
  });

  it('keeps at most 72 characters', () => {
    expect(sanitizeMessage('x'.repeat(100))).toBe('x'.repeat(72));
  });

  it('drops bidi overrides', () => {
    expect(sanitizeMessage('‮ evil')).toBe('evil');
  });

  it('drops zero-width and line separators', () => {
    expect(sanitizeMessage('a​b c')).toBe('abc');
  });

  it('drops word joiners and soft hyphens', () => {
    expect(sanitizeMessage('x⁠y­z')).toBe('xyz');
  });

  it('gives an empty string for control characters only', () => {
    expect(sanitizeMessage('\u0000\n')).toBe('');
  });

  it('leaves an ordinary message unchanged', () => {
    expect(sanitizeMessage('day 001: dawn')).toBe('day 001: dawn');
  });
});
