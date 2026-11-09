import { describe, expect, it } from 'vitest';
import { setLedgerStatus } from './ledger.ts';

const doc = [
  '# Ledger',
  '| ID | Wave | Size | Title | Agent | Status | Deps |',
  '|---|---|---|---|---|---|---|',
  '| SC-40a | 4 | S | one | packet-coder | Ready | SC-01 |',
  '| SC-40b | 4 | S | two | packet-coder | Ready | SC-40a |',
  '| SC-4 | 4 | S | other | packet-coder | Ready | — |',
  'SC-40a mentioned in prose | not a row',
  '',
].join('\n');

describe('setLedgerStatus', () => {
  it('changes only the anchored row and leaves every other line byte-identical', () => {
    const out = setLedgerStatus(doc, 'SC-40a', 'Done');
    const a = doc.split('\n');
    const b = out.split('\n');
    expect(b[3]).toBe('| SC-40a | 4 | S | one | packet-coder | Done | SC-01 |');
    expect(b.filter((l, i) => l !== a[i])).toHaveLength(1);
    expect(out).not.toContain('\r');
  });
  it('anchors exactly: SC-4 does not touch SC-40a', () => {
    expect(setLedgerStatus(doc, 'SC-4', 'Done').split('\n')[3]).toContain('Ready');
  });
  it('errors on zero or several matches', () => {
    expect(() => setLedgerStatus(doc, 'SC-99', 'Done')).toThrow(/found 0/);
    expect(() => setLedgerStatus(`${doc}${doc}`, 'SC-40a', 'Done')).toThrow(/found 2/);
  });
  it('rejects a status that would break the table', () => {
    expect(() => setLedgerStatus(doc, 'SC-40a', 'a | b')).toThrow();
  });
  it('keeps columns aligned when a cell holds an escaped pipe', () => {
    const row = '| SC-1 | 4 | S | a \\| b | packet-coder | todo | - |';
    const out = setLedgerStatus(`${row}\n`, 'SC-1', 'done');
    expect(out).toBe('| SC-1 | 4 | S | a \\| b | packet-coder | done | - |\n');
  });
  it('accepts ids with a trailing digit and rejects malformed ids', () => {
    const d = '| SC-60b1 | 6 | S | gate | packet-coder | Ready | - |
| SC-60b2 | 6 | S | gate | packet-coder | Ready | - |
';
    const out = setLedgerStatus(d, 'SC-60b1', 'Done').split('
');
    expect(out[0]).toContain('Done');
    expect(out[1]).toContain('Ready');
    expect(() => setLedgerStatus(d, 'SC-60b12', 'Done')).toThrow(/not a ledger id/);
    expect(() => setLedgerStatus(d, 'SC-60bb', 'Done')).toThrow(/not a ledger id/);
  });
});
