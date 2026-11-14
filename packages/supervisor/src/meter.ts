import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Tokens of one run: input is uncached input, cached is input read from the cache, output is generated. */
export interface TokenUsage {
  input: number;
  cached: number;
  output: number;
}

/** No single count is trusted above this (a corrupt or hostile value cannot dominate a sum). */
const CAP = 1e12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A count from a stream or a csv cell: a finite number, clamped to 0..CAP; anything else is 0. */
function count(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(n, CAP)) : 0;
}

/**
 * Reads the last `result` line of a session stream. Claude: input = input_tokens +
 * cache_creation_input_tokens, cached = cache_read_input_tokens, output = output_tokens. Owned loops
 * (chatgpt, local): the usage already is {input_tokens, cached_input_tokens, output_tokens} with input
 * uncached. Absent keys are 0. Returns zeros when there is no result line or the file is unreadable.
 */
export function readTokenUsage(path: string, harness: 'claude' | 'chatgpt' | 'local'): TokenUsage {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { input: 0, cached: 0, output: 0 };
  }
  let result: Record<string, unknown> | null = null;
  for (const line of text.split('\n')) {
    try {
      const entry: unknown = JSON.parse(line);
      if (isRecord(entry) && entry.type === 'result') result = entry;
    } catch {
      // not a json line
    }
  }
  const usage = result && isRecord(result.usage) ? result.usage : {};
  if (harness === 'claude') {
    return {
      input: count(usage.input_tokens) + count(usage.cache_creation_input_tokens),
      cached: count(usage.cache_read_input_tokens),
      output: count(usage.output_tokens),
    };
  }
  return {
    input: count(usage.input_tokens),
    cached: count(usage.cached_input_tokens),
    output: count(usage.output_tokens),
  };
}

/** Sum of input + output over the lines of tokens.csv whose utc column starts with the UTC date (cached excluded). */
export function tokensToday(stateDir: string, date: string): number {
  const file = join(stateDir, 'tokens.csv');
  if (!existsSync(file)) return 0;
  let sum = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    // run,utc,input,cached,output
    const cols = line.split(',');
    if (cols[1]?.startsWith(date)) sum += count(cols[2]) + count(cols[4]);
  }
  return sum;
}
