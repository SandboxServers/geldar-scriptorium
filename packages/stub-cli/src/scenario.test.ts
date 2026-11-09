import { describe, expect, it } from 'vitest';
import { parseScenario } from './scenario.ts';

describe('parseScenario', () => {
  it('parses a valid file, skips blank lines and fills the defaults', () => {
    const text = [
      '{"op":"call","server":"geldar_memory","tool":"recall","args":{"section":"summary"},"expect":{"error":false,"includes":["You are"],"excludes":[]}}',
      '',
      '{"op":"write","path":"memory/summary.md","content":"hi"}',
      '{"op":"append","path":"memory/journal/current.md","content":"- 09:00 wait\\n"}',
      '{"op":"delete","path":"memory/people/pike.md"}',
      '{"op":"call","server":"geldar_memory","tool":"recall"}',
      '',
    ].join('\n');
    expect(parseScenario(text)).toEqual([
      {
        op: 'call',
        server: 'geldar_memory',
        tool: 'recall',
        args: { section: 'summary' },
        expect: { error: false, includes: ['You are'], excludes: [] },
      },
      { op: 'write', path: 'memory/summary.md', content: 'hi' },
      { op: 'append', path: 'memory/journal/current.md', content: '- 09:00 wait\n' },
      { op: 'delete', path: 'memory/people/pike.md' },
      {
        op: 'call',
        server: 'geldar_memory',
        tool: 'recall',
        args: {},
        expect: { error: false, includes: [], excludes: [] },
      },
    ]);
  });

  it('names the line number of each rejection', () => {
    const good = '{"op":"delete","path":"a.md"}';
    const bad: string[] = [
      '{not json',
      '["an","array"]',
      '{"op":"rename","path":"a.md"}',
      '{"op":"delete","path":"a.md","force":true}',
      '{"op":"write","path":"a.md"}',
      '{"op":"write","path":"a.md","content":5}',
      '{"op":"delete","path":"/etc/passwd"}',
      '{"op":"delete","path":"C:/x.md"}',
      '{"op":"delete","path":"memory/../x.md"}',
      '{"op":"delete","path":"memory\\\\x.md"}',
      '{"op":"call","server":"s","tool":"t","expect":{"error":"no"}}',
      '{"op":"call","server":"s","tool":"t","args":[]}',
      '{"op":"call","server":"s","tool":"t","expect":{"includes":"x"}}',
      '{"op":"call","server":"s","tool":"t","expect":{"maybe":true}}',
    ];
    for (const line of bad) {
      expect(() => parseScenario(`${good}\n${line}\n`)).toThrow('scenario line 2:');
    }
  });
});
