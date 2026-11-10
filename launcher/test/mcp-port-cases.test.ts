import { describe, expect, it } from 'vitest';
import { portCases } from './mcp-port-suite.ts';

// SC-76a: the shape of the mcp_port table. The suite itself runs from SC-76c and SC-76d.

describe('mcp_port case table (shape)', () => {
  it('has rows with base, port, url as text and ok as a boolean', () => {
    expect(portCases.length).toBeGreaterThan(0);
    for (const row of portCases) {
      expect(Object.keys(row).sort()).toEqual(['base', 'ok', 'port', 'url']);
      expect(typeof row.base).toBe('string');
      expect(typeof row.port).toBe('string');
      expect(typeof row.url).toBe('string');
      expect(typeof row.ok).toBe('boolean');
    }
  });

  it('has no duplicate rows', () => {
    const keys = portCases.map((r) => JSON.stringify([r.base, r.port, r.url]));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
