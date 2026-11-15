import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { actIntent, parseInstinctResult } from './contract.ts';

const here = dirname(fileURLToPath(import.meta.url));

const settle = (why: string, line: string) => ({
  v: 1,
  kind: 'settle',
  fx: 'none',
  why,
  act: actIntent('gather_oak_log', 'gather', { block: 'oak_log', count: 4 }),
  rolls: [],
  world: { accepted: true, line },
});

const withFacts = (facts: string[]) => ({
  v: 1,
  kind: 'pass-with-facts',
  fx: 'none',
  facts,
  rolls: [],
});

describe('parseInstinctResult facts count', () => {
  it('accepts exactly four facts', () => {
    const text = JSON.stringify(withFacts(['a', 'b', 'c', 'd']));
    expect(parseInstinctResult(text)).not.toBeNull();
  });

  it('rejects five facts', () => {
    const text = JSON.stringify(withFacts(['a', 'b', 'c', 'd', 'e']));
    expect(parseInstinctResult(text)).toBeNull();
  });
});

describe('parseInstinctResult printable text', () => {
  it('accepts a settle with printable why and world.line', () => {
    const text = JSON.stringify(settle('nothing to fear', 'Your act was accepted.'));
    expect(parseInstinctResult(text)?.kind).toBe('settle');
  });

  it('rejects a settle whose why holds a control character', () => {
    const text = JSON.stringify(settle('bad\u0007why', 'Your act was accepted.'));
    expect(parseInstinctResult(text)).toBeNull();
  });

  it('rejects a settle whose world.line holds a newline', () => {
    const text = JSON.stringify(settle('ok', 'line one\nline two'));
    expect(parseInstinctResult(text)).toBeNull();
  });
});

describe('actIntent', () => {
  it('carries wake_on and limits, as thought.schema.json Intent requires', () => {
    const intent = (actIntent('g', 'p', {}).arguments as { intent: Record<string, unknown> })
      .intent;
    expect(intent.wake_on).toEqual(['goal_completed']);
    expect(intent.limits).toEqual({ max_world_ticks: 2400, max_block_operations: 64 });
  });
});

describe('contract.ts purity', () => {
  it('imports nothing', () => {
    const text = readFileSync(join(here, 'contract.ts'), 'utf8');
    expect(text).not.toMatch(/^\s*import\s/m);
    expect(text).not.toMatch(/\brequire\(/);
  });
});
