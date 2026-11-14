import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTokenUsage, tokensToday } from './meter.ts';

/** A session file whose last line is the given result usage (other lines are the stream's own). */
function session(usage: Record<string, unknown> | null): string {
  const lines = [{ type: 'assistant', message: { content: [] } }];
  if (usage !== null) lines.push({ type: 'result', usage } as never);
  const dir = mkdtempSync(join(tmpdir(), 'geldar-meter-'));
  const path = join(dir, 'session-1.jsonl');
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  return path;
}

describe('readTokenUsage', () => {
  it('maps a Claude result line: input is input plus cache creation, cached is the cache read', () => {
    const path = session({
      input_tokens: 10,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 100,
      output_tokens: 7,
    });
    expect(readTokenUsage(path, 'claude')).toEqual({ input: 15, cached: 100, output: 7 });
  });

  it('reads an owned-loop result line (chatgpt, local) through unchanged', () => {
    const path = session({ input_tokens: 50, cached_input_tokens: 40, output_tokens: 3 });
    expect(readTokenUsage(path, 'chatgpt')).toEqual({ input: 50, cached: 40, output: 3 });
    expect(readTokenUsage(path, 'local')).toEqual({ input: 50, cached: 40, output: 3 });
  });

  it('reads zeros with no result line, no usage or an unreadable file', () => {
    expect(readTokenUsage(session(null), 'claude')).toEqual({ input: 0, cached: 0, output: 0 });
    expect(readTokenUsage(session({}), 'chatgpt')).toEqual({ input: 0, cached: 0, output: 0 });
    expect(readTokenUsage(join(tmpdir(), 'no-such-session.jsonl'), 'claude')).toEqual({
      input: 0,
      cached: 0,
      output: 0,
    });
  });

  it('counts a non-finite or huge value as 0 or the cap of 1e12', () => {
    const path = session({ input_tokens: 'x', output_tokens: 1e30 });
    expect(readTokenUsage(path, 'chatgpt')).toEqual({ input: 0, cached: 0, output: 1e12 });
  });
});

describe('tokensToday', () => {
  it('sums input and output of the rows dated today, excludes cached and skips a malformed row', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geldar-tokens-'));
    writeFileSync(
      join(dir, 'tokens.csv'),
      [
        '1,2026-01-10T10:00:00Z,10,4,5',
        '2,2026-01-10T23:00:00Z,20,9,30',
        '3,2026-01-09T23:59:59Z,1000,0,1000',
        'garbage',
        '4,2026-01-10T01:00:00Z,x,0,7',
        '',
      ].join('\n'),
    );
    // 15 + 50 today; row 3 is yesterday; the garbage line has no date; row 4 counts its x as 0.
    expect(tokensToday(dir, '2026-01-10')).toBe(72);
  });

  it('is 0 when there is no tokens.csv', () => {
    expect(tokensToday(join(tmpdir(), 'no-such-state-dir'), '2026-01-10')).toBe(0);
  });
});
