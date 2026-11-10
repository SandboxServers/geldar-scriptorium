import { describe, expect, it } from 'vitest';
import { personaCases } from './persona-suite.ts';

describe('persona-cases.json', () => {
  it('has unique names and a complete expect and reason on every row', () => {
    const names = personaCases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of personaCases) {
      expect(typeof c.expect, c.name).toBe('string');
      expect(c.expect, c.name).not.toBe('');
      expect(typeof c.reason, c.name).toBe('string');
      expect(c.reason !== '', c.name).toBe(c.expect === 'persona_bad');
    }
  });

  it('has a row for each refused invisible range', () => {
    const invisible = personaCases.filter((c) => c.reason === 'invisible').map((c) => c.name);
    for (const n of [
      'bidi override',
      'zero-width space',
      'byte order mark',
      'line separator U+2028',
      'soft hyphen',
      'tag character',
      'variation selector',
    ]) {
      expect(invisible, n).toContain(n);
    }
  });

  it('uses only the named reasons and expectations', () => {
    const reasons = ['size', 'utf8', 'control', 'invisible', 'link', 'type', 'empty', 'twice'];
    for (const c of personaCases) {
      expect(['ok', 'persona_missing', 'persona_bad'], c.name).toContain(c.expect);
      if (c.reason !== '') expect(reasons, c.name).toContain(c.reason);
    }
  });
});
