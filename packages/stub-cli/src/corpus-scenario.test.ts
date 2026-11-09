import { describe, expect, it } from 'vitest';
import { corpusReadScenario } from './corpus-scenario.ts';
import { parseScenario } from './scenario.ts';

const entries = Array.from({ length: 9 }, (_, i) => ({
  canary: `CANARY-MB0${i + 1}-abcdef01`,
  book_id: `bk_mb0${i + 1}`,
  read_tool: 'read_book',
}));

describe('corpusReadScenario', () => {
  it('parses, reads the book, expects the canary and never writes', () => {
    for (const e of entries) {
      const steps = parseScenario(corpusReadScenario(e));
      expect(steps.map((s) => s.op)).toEqual(['call', 'call']);
      const first = steps[0];
      if (first?.op !== 'call') throw new Error('first step is not a call');
      expect(first.tool).toBe('read_book');
      expect(first.args).toEqual({ book_id: e.book_id });
      expect(first.expect.includes).toEqual([e.canary]);
      for (const s of steps) expect(['write', 'append', 'delete']).not.toContain(s.op);
    }
  });
});
