import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendAudit, buildAuditLine } from './audit.ts';
import type { InstinctResult } from './contract.ts';

const meta = {
  ts: '2026-11-15T10:00:00Z',
  waking: 12,
  run: 7,
  arm: 'instinct',
  harness: 'claude',
  model: 'haiku',
};
const settle: InstinctResult = {
  v: 1,
  kind: 'settle',
  fx: 'idle',
  why: 'habit for the top goal',
  act: { tool: 'act', arguments: { program: 'walk' } },
  rolls: [],
  world: { accepted: true, line: 'Your intent was accepted.' },
};
const kinds: InstinctResult[] = [
  settle,
  {
    v: 1,
    kind: 'pass-with-facts',
    fx: 'none',
    facts: ['You have not seen Ann before.'],
    rolls: [],
  },
  { v: 1, kind: 'pass', reason: 'first_sighting', forced: true, rolls: [] },
];

describe('audit', () => {
  it('every kind carries source "instinct" and the contract fields', () => {
    for (const result of kinds) {
      const line = JSON.parse(buildAuditLine(meta, result));
      expect(line.source).toBe('instinct');
      expect(line.v).toBe(1);
      expect(line.kind).toBe(result.kind);
    }
  });

  it('model_called is false only for a settle', () => {
    const lines = kinds.map((r) => JSON.parse(buildAuditLine(meta, r)));
    expect(lines.map((l) => l.model_called)).toEqual([false, true, true]);
    expect(lines[2].reason).toBe('first_sighting');
    expect(lines[2].forced).toBe(true);
  });

  it('appendAudit appends one line per call', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'instinct-audit-')), 'instinct.jsonl');
    appendAudit(file, buildAuditLine(meta, settle));
    appendAudit(file, buildAuditLine(meta, kinds[2] as InstinctResult));
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string).kind).toBe('settle');
  });
});
