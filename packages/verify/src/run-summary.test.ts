import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  ERROR_RUN,
  GOOD,
  MISSING_NUMBERS,
  NOISE,
  SURROGATE,
  TRUNCATED,
  TWO_RESULTS,
} from './run-summary.fixtures.ts';

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));

function run(input: string, args: string[] = []) {
  return spawnSync(process.execPath, [CLI, 'run-summary', ...args], {
    input,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

/** A stream with one assistant text per argument, then a good result line. */
function streamOf(...texts: string[]): string {
  const lines = texts.map((t) =>
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } }),
  );
  lines.push(
    JSON.stringify({ type: 'result', total_cost_usd: 0.1, num_turns: 1, is_error: false }),
  );
  return `${lines.join('\n')}\n`;
}

function summary(input: string) {
  const r = run(input);
  expect(r.status).toBe(0);
  expect(r.stdout.endsWith('\n')).toBe(true);
  expect(r.stdout.trimEnd().split('\n')).toHaveLength(1);
  return JSON.parse(r.stdout);
}

describe('geldar-verify run-summary', () => {
  it('summarises a good run', () => {
    const out = summary(GOOD);
    expect(out).toEqual({
      cost: 0.42,
      turns: 3,
      is_error: false,
      last_text: 'All done.',
      result_seen: true,
      tools: { Read: 2, Bash: 1 },
    });
    expect(run(GOOD).stdout).not.toContain('SECRET');
  });

  it('reports an error run', () => {
    const out = summary(ERROR_RUN);
    expect(out).toMatchObject({ cost: 1.5, turns: 7, is_error: true, result_seen: true });
  });

  it('treats a stream truncated before the result as an error', () => {
    expect(summary(TRUNCATED)).toEqual({
      cost: 0,
      turns: 0,
      is_error: true,
      last_text: 'Midway.',
      result_seen: false,
      tools: { Edit: 1 },
    });
  });

  it('handles an empty stream', () => {
    expect(summary(EMPTY)).toEqual({
      cost: 0,
      turns: 0,
      is_error: true,
      last_text: '',
      result_seen: false,
      tools: {},
    });
  });

  it('skips non-JSON noise lines', () => {
    expect(summary(NOISE)).toMatchObject({
      cost: 0.1,
      turns: 1,
      is_error: false,
      last_text: 'Real text.',
      result_seen: true,
    });
  });

  it('defaults missing numeric fields to zero', () => {
    expect(summary(MISSING_NUMBERS)).toMatchObject({
      cost: 0,
      turns: 0,
      is_error: false,
      result_seen: true,
    });
  });

  it('takes the last result line', () => {
    expect(summary(TWO_RESULTS)).toMatchObject({ cost: 2, turns: 2, is_error: false });
  });

  it('keeps the last 1500 characters of a long message', () => {
    const out = summary(streamOf(`FIRST${'-'.repeat(2991)}LAST`));
    expect(out.last_text).toHaveLength(1500);
    expect(out.last_text).toBe(`${'-'.repeat(1496)}LAST`);
    expect(out.last_text.includes('FIRST')).toBe(false);
  });

  it('keeps the end of a message with an emoji near the start', () => {
    const out = summary(SURROGATE);
    expect(out.last_text).toBe(`${'a'.repeat(1495)}\u{1F600}tail`);
  });

  it('never starts the kept text with a lone surrogate', () => {
    // 5 a, an emoji (two UTF-16 units), 1499 b: the last 1500 characters are the emoji and the b's.
    const out = summary(streamOf(`${'a'.repeat(5)}\u{1F600}${'b'.repeat(1499)}`));
    expect(out.last_text).toBe(`\u{1F600}${'b'.repeat(1499)}`);
    const first = out.last_text.charCodeAt(0);
    expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
  });

  it('drops a lone low surrogate at the new start', () => {
    const out = summary(streamOf(`${'d'.repeat(3)}\uDC00${'c'.repeat(1499)}`));
    expect(out.last_text).toBe('c'.repeat(1499));
  });

  it('keeps 1500 characters unchanged', () => {
    const out = summary(streamOf('y'.repeat(1500)));
    expect(out.last_text).toBe('y'.repeat(1500));
  });

  it('strips control characters before the cut', () => {
    const out = summary(streamOf(`${'x'.repeat(1500)}\u001b[31mend\n`));
    expect(out.last_text).toBe(`${'x'.repeat(1493)}[31mend`);
    expect([...out.last_text].some((c) => c.charCodeAt(0) < 0x20 || c === '\u007f')).toBe(false);
  });

  it('exits 2 on an unknown option', () => {
    expect(run(GOOD, ['--bogus']).status).toBe(2);
  });

  it('streams a 20 MB input quickly', () => {
    const filler = `${JSON.stringify({ type: 'user', pad: 'p'.repeat(1000) })}\n`;
    const input = filler.repeat(20_000) + GOOD;
    const started = Date.now();
    expect(summary(input)).toMatchObject({ cost: 0.42, turns: 3 });
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 60_000);
});
