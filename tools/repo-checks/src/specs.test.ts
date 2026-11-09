import { describe, expect, it } from 'vitest';
import { checkSpecs, ledgerIds } from './specs.ts';

const readme = '| SC-01 | a |\n| SC-40a | b |\n| SC-40b | c |\n';
const run = (text: string, file = 'x.md') => checkSpecs([{ file, text }], readme);

describe('ledgerIds', () => {
  it('reads suffixed and plain ids from first cells only', () => {
    expect([...ledgerIds(`${readme}| 3 | SC-99 |\n`)]).toEqual(['SC-01', 'SC-40a', 'SC-40b']);
  });
});

describe('checkSpecs', () => {
  it('accepts known ids including suffixed ones', () => {
    expect(run('See SC-01 and SC-40a.\n')).toEqual([]);
  });
  it('flags a dangling id with file:line', () => {
    expect(run('ok\nSee SC-77.\n')).toEqual([
      { file: 'x.md', line: 2, message: 'SC-77 has no ledger row' },
    ]);
  });
  it('flags an unsuffixed id when only suffixed rows exist, unless listed as legacy', () => {
    expect(run('SC-40 here\n')).toHaveLength(1);
    expect(run('<!-- legacy-ids: SC-40 -->\nSC-40 here\n')).toEqual([]);
  });
  it('does not treat SC-40ab or SC-401 as SC-40a', () => {
    expect(run('SC-401\n')).toHaveLength(1);
  });
  it('flags CR and control characters', () => {
    expect(run('a\r\nb\n').map((f) => f.line)).toEqual([1]);
    expect(run('a\nb\u0001\n')).toEqual([{ file: 'x.md', line: 2, message: 'control character' }]);
  });
  it('allows tabs', () => {
    expect(run('a\tb\n')).toEqual([]);
  });
  it('flags a code span broken across lines, not balanced spans or fences', () => {
    const f = run('use `pnpm\ninstall` now\n');
    expect(f).toEqual([
      { file: 'x.md', line: 1, message: 'inline code span contains a literal line break' },
    ]);
    expect(run('use `a` and `b`\n```\nodd ` tick\n```\n')).toEqual([]);
  });
});
