const line = (o: unknown): string => JSON.stringify(o);
const assistant = (...content: unknown[]): string =>
  line({ type: 'assistant', message: { content } });
const text = (t: string) => ({ type: 'text', text: t });
const tool = (name: string, input: unknown = { secret: 'SECRET-INPUT' }) => ({
  type: 'tool_use',
  name,
  input,
});
const result = (o: Record<string, unknown>): string => line({ type: 'result', ...o });
const join = (...lines: string[]): string => `${lines.join('\n')}\n`;

export const GOOD = join(
  line({ type: 'system', subtype: 'init' }),
  assistant(text('Starting.'), tool('Read'), tool('Bash')),
  line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'SECRET-RESULT' }] } }),
  assistant(tool('Read'), text('  All done.  ')),
  result({ total_cost_usd: 0.42, num_turns: 3, is_error: false, result: 'All done.' }),
);

export const ERROR_RUN = join(
  assistant(text('Trying.'), tool('Bash')),
  result({ total_cost_usd: 1.5, num_turns: 7, is_error: true }),
);

export const TRUNCATED = join(
  assistant(text('Midway.'), tool('Edit')),
  '{"type":"assistant","mess',
);

export const EMPTY = '';

export const NOISE = join(
  'warning: not json',
  assistant(text('Real text.')),
  '',
  '[1,2,3]',
  '{broken',
  result({ total_cost_usd: 0.1, num_turns: 1, is_error: false }),
  'trailing garbage',
);

export const MISSING_NUMBERS = join(assistant(text('Hi.')), result({ subtype: 'success' }));

export const TWO_RESULTS = join(
  result({ total_cost_usd: 1, num_turns: 1, is_error: true }),
  result({ total_cost_usd: 2, num_turns: 2, is_error: false }),
);

/** Last text: ESC and newline bytes among 5000 characters. */
export const LONG_CONTROL_TEXT = `start\u001b[31m\nline\ttab\u007f${'x'.repeat(4980)}`;
export const LONG_CONTROL = join(
  assistant(text('earlier')),
  assistant(text(LONG_CONTROL_TEXT)),
  result({ total_cost_usd: 0.5, num_turns: 2, is_error: false }),
);

/** Emoji straddling the 1500 character boundary. */
export const SURROGATE = join(assistant(text(`${'a'.repeat(1499)}\u{1F600}tail`)));
