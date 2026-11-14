import { ChatGPTError, type Fetch, RESOURCE, record } from './auth.ts';

export type Item = Record<string, unknown>;
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  call(args: Record<string, unknown>): Promise<unknown>;
}

/** SSE is framed by blank lines, independent of network chunks or CRLF boundaries. */
export async function completed(response: Response): Promise<Item> {
  if (!response.ok)
    throw new ChatGPTError(
      `ChatGPT request failed (HTTP ${response.status}). Check plan access and usage limits.`,
    );
  if (!response.body) throw new ChatGPTError('ChatGPT returned an empty stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let frame = '';
  const event = (data: string): Item | null => {
    if (!data || data === '[DONE]') return null;
    const e: unknown = JSON.parse(data);
    if (!record(e)) return null;
    if (e.type === 'response.failed' || e.type === 'response.incomplete' || e.type === 'error') {
      throw new ChatGPTError('ChatGPT did not complete the round.');
    }
    if (e.type !== 'response.completed') return null;
    if (
      !record(e.response) ||
      e.response.status !== 'completed' ||
      !Array.isArray(e.response.output)
    ) {
      throw new ChatGPTError('Invalid ChatGPT completion.');
    }
    return e.response;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (pending.length + frame.length > 16 * 1024 * 1024)
        throw new ChatGPTError('ChatGPT stream exceeded its limit.');
      let at = pending.indexOf('\n');
      while (at !== -1) {
        const line = pending.slice(0, at).replace(/\r$/, '');
        pending = pending.slice(at + 1);
        if (line === '') {
          const result = event(frame.trimEnd());
          frame = '';
          if (result) return result;
        } else if (line.startsWith('data:')) frame += `${line.slice(5).trimStart()}\n`;
        at = pending.indexOf('\n');
      }
      if (done) break;
    }
    throw new ChatGPTError('ChatGPT disconnected before response.completed.');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export interface Round {
  model: string;
  instructions: string;
  prompt: string;
  maxTurns: number;
  tools: Tool[];
  access(): Promise<string>;
  emit(item: Item): void;
  request?: Fetch;
}

/** Adds one completion's usage to the running total: input uncached (never below 0), cached and output. */
function addUsage(total: { input: number; cached: number; output: number }, raw: unknown): void {
  const usage: Item = record(raw) ? raw : {};
  const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const details: Item = record(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const input = count(usage.input_tokens);
  const cached = count(details.cached_tokens);
  total.input += Math.max(0, input - cached);
  total.cached += cached;
  total.output += count(usage.output_tokens);
}

/** No shell, arbitrary URLs, vendor tools or host file tools are exposed to this mind. */
export async function runRound(round: Round): Promise<void> {
  const request = round.request ?? fetch;
  const input: Item[] = [{ role: 'user', content: round.prompt }];
  const byName = new Map(round.tools.map((t) => [t.name, t]));
  const usage = { input: 0, cached: 0, output: 0 };
  let turns = 0;
  let text = '';
  // The usage the owned loop's result line reports (input is uncached, see meter.ts).
  const reported = () => ({
    input_tokens: usage.input,
    cached_input_tokens: usage.cached,
    output_tokens: usage.output,
  });
  try {
    for (; turns < round.maxTurns; ) {
      const access = await round.access();
      const res = await request(`${RESOURCE}/responses`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10 * 60_000),
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: round.model,
          instructions: round.instructions,
          input,
          store: false,
          stream: true,
          include: ['reasoning.encrypted_content'],
          parallel_tool_calls: false,
          tools: [
            {
              type: 'namespace',
              name: 'geldar',
              description: 'Your world and your memories.',
              tools: round.tools.map((t) => ({
                type: 'function',
                name: t.name,
                description: t.description,
                parameters: t.parameters,
                strict: false,
              })),
            },
          ],
        }),
      });
      const result = await completed(res);
      addUsage(usage, result.usage);
      turns++;
      // Replaying output, including encrypted reasoning, is required with store:false.
      const output = (result.output as unknown[]).filter(record);
      input.push(...output);
      const calls = output.filter((i) => i.type === 'function_call');
      for (const item of output) {
        if (item.type === 'message' && Array.isArray(item.content)) {
          for (const block of item.content)
            if (record(block) && block.type === 'output_text' && typeof block.text === 'string')
              text = block.text;
        }
      }
      round.emit({
        type: 'assistant',
        message: {
          content: [
            ...(text ? [{ type: 'text', text }] : []),
            ...calls.map((c) => ({
              type: 'tool_use',
              name: c.name,
              id: c.call_id,
              input: c.arguments,
            })),
          ],
        },
        usage: result.usage,
      });
      if (calls.length === 0) {
        round.emit({
          type: 'result',
          is_error: false,
          num_turns: turns,
          total_cost_usd: 0,
          result: text,
          cost_source: 'unavailable_subscription',
          usage: reported(),
        });
        return;
      }
      for (const call of calls) {
        // Namespaced calls carry the namespace separately. Reject anything outside our table.
        const tool =
          typeof call.name === 'string' &&
          (call.namespace === undefined || call.namespace === 'geldar')
            ? byName.get(call.name)
            : undefined;
        let answer: unknown;
        try {
          const args: unknown = JSON.parse(String(call.arguments));
          if (!tool || !record(args) || typeof call.call_id !== 'string')
            throw new Error('invalid call');
          answer = await tool.call(args);
        } catch {
          answer = [{ type: 'input_text', text: 'That tool call could not be completed.' }];
        }
        input.push({ type: 'function_call_output', call_id: call.call_id, output: answer });
      }
    }
    throw new ChatGPTError('ChatGPT round reached GELDAR_RUN_MAX_TURNS.');
  } catch (err) {
    round.emit({
      type: 'result',
      is_error: true,
      num_turns: turns,
      total_cost_usd: 0,
      cost_source: 'unavailable_subscription',
      usage: reported(),
    });
    throw err;
  }
}
