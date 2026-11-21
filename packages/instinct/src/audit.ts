// The audit: one JSON line per instinct run in instinct.jsonl. The line is built only from the result and the run
// metadata. Rolls derived from the sheet (score, dc, bonus, dice) reach it; the facts and the why text do not (the
// test scans for the sheet's field names).
import { appendFileSync } from 'node:fs';
import type { InstinctResult } from './contract.ts';
import { INSTINCT_V } from './contract.ts';

export interface AuditMeta {
  ts: string;
  waking: number;
  run: number;
  arm: string;
  harness: string | null;
  model: string | null;
}

export function appendAudit(path: string, line: string): void {
  appendFileSync(path, `${line}\n`, { mode: 0o600 });
}

/** The fixed fields of the contract's example line, as one JSON string (no trailing newline). */
export function buildAuditLine(meta: AuditMeta, result: InstinctResult): string {
  const base = {
    v: INSTINCT_V,
    ts: meta.ts,
    waking: meta.waking,
    run: meta.run,
    arm: meta.arm,
    source: 'instinct',
    harness: meta.harness,
    model: meta.model,
  };
  if (result.kind === 'settle') {
    return JSON.stringify({
      ...base,
      kind: 'settle',
      fx: result.fx,
      reason: null,
      forced: false,
      why: result.why,
      act: result.act,
      world: result.world,
      facts: [],
      rolls: result.rolls,
      model_called: false,
    });
  }
  if (result.kind === 'pass-with-facts') {
    return JSON.stringify({
      ...base,
      kind: 'pass-with-facts',
      fx: result.fx,
      reason: null,
      forced: false,
      why: null,
      act: null,
      world: null,
      facts: result.facts,
      rolls: result.rolls,
      model_called: true,
    });
  }
  return JSON.stringify({
    ...base,
    kind: 'pass',
    fx: 'none',
    reason: result.reason,
    forced: result.forced,
    why: null,
    act: null,
    world: null,
    facts: [],
    rolls: result.rolls,
    model_called: true,
  });
}
