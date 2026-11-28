import { describe, expect, it, vi } from 'vitest';
import { type ChatConfig, ChatTransport } from './chat.ts';
import { runLoop } from './loop.ts';
import { estimateTokens, MESSAGE_OVERHEAD } from './tokens.ts';
import type { Fetch, ToolCall, ToolReturn } from './transport.ts';
import type { Item, Tool } from './types.ts';

const BASE = 'http://127.0.0.1:11434/v1';
const TOOL = { name: 'probe', description: 'test', parameters: { type: 'object', properties: {} } };

/** A fake fetch that answers each request with the next scripted body (status 200 unless given). */
function fake(replies: { status?: number; body: unknown }[]) {
  const request = vi.fn<Fetch>(async () => {
    const next = replies.shift();
    if (!next) throw new Error('no scripted reply');
    const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return new Response(text, { status: next.status ?? 200 });
  });
  return { request, fetch: request };
}

/** The JSON body of the nth request the fake received. */
function sentBody(request: ReturnType<typeof fake>['request'], n: number): Record<string, unknown> {
  const init = request.mock.calls[n]?.[1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function transport(
  request: Fetch,
  extra: { apiKey?: string; baseUrl?: string } = {},
): ChatTransport {
  return new ChatTransport({
    baseUrl: extra.baseUrl ?? BASE,
    ...(extra.apiKey ? { apiKey: extra.apiKey } : {}),
    model: 'qwen3:8b',
    instructions: 'You are the mind.',
    tools: [TOOL],
    request,
  });
}

describe('ChatTransport request', () => {
  it('posts to chat/completions with and without a trailing slash, without a key header', async () => {
    for (const baseUrl of [BASE, `${BASE}/`]) {
      const { request, fetch } = fake([{ body: { choices: [{ message: { content: 'ok' } }] } }]);
      await transport(fetch, { baseUrl }).send({ prompt: 'hi' });
      expect(request.mock.calls[0]?.[0]).toBe(`${BASE}/chat/completions`);
      const init = request.mock.calls[0]?.[1] as RequestInit;
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(init.redirect).toBe('error');
    }
  });

  it('sends Authorization only with a key, and the key appears nowhere in the body', async () => {
    const { request, fetch } = fake([{ body: { choices: [{ message: { content: 'ok' } }] } }]);
    await transport(fetch, { apiKey: 'k' }).send({ prompt: 'hi' });
    const init = request.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: 'Bearer k' });
    expect(String(init.body)).not.toContain('"k"');
    expect(String(init.body)).not.toContain('Bearer');
  });

  it('sends only the allowed keys, with stream false and tools wrapped as functions', async () => {
    const { request, fetch } = fake([{ body: { choices: [{ message: { content: 'ok' } }] } }]);
    await transport(fetch).send({ prompt: 'hi' });
    const body = sentBody(request, 0);
    for (const key of [
      'tool_choice',
      'parallel_tool_calls',
      'strict',
      'temperature',
      'response_format',
      'stream_options',
      'store',
    ]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(body).toMatchObject({ model: 'qwen3:8b', stream: false, max_tokens: 2048 });
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'probe', description: 'test', parameters: TOOL.parameters },
      },
    ]);
  });

  it('JSON of the transport never shows the api key', async () => {
    const { fetch } = fake([{ body: { choices: [{ message: { content: 'ok' } }] } }]);
    const chat = transport(fetch, { apiKey: 'key-never-shown-42' });
    await chat.send({ prompt: 'hi' });
    expect(JSON.stringify(chat)).not.toContain('key-never-shown-42');
  });

  it('omits tools when the list is empty', async () => {
    const { request, fetch } = fake([{ body: { choices: [{ message: { content: 'ok' } }] } }]);
    await new ChatTransport({
      baseUrl: BASE,
      model: 'm',
      instructions: 'i',
      tools: [],
      request: fetch,
    }).send({
      prompt: 'hi',
    });
    expect(sentBody(request, 0)).not.toHaveProperty('tools');
  });
});

describe('ChatTransport replies', () => {
  it('normalises two calls (one without an id, one with object arguments) to unique ids', async () => {
    const { fetch } = fake([
      {
        body: {
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                content: null,
                tool_calls: [
                  { id: 'a', type: 'function', function: { name: 'probe', arguments: '{"x":1}' } },
                  { type: 'function', function: { name: 'probe', arguments: { x: 2 } } },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 4 },
        },
      },
    ]);
    const reply = await transport(fetch).send({ prompt: 'hi' });
    expect(reply.calls).toEqual([
      { id: 'a', name: 'probe', arguments: '{"x":1}' },
      { id: 'call_1', name: 'probe', arguments: '{"x":2}' },
    ]);
    expect(reply.usage).toEqual({ input: 10, cached: 0, output: 4 });
  });

  it('keeps a string argument as the same text and gives a repeated id a fresh one', async () => {
    const { fetch } = fake([
      {
        body: {
          choices: [
            {
              message: {
                tool_calls: [
                  { id: 'same', function: { name: 'probe', arguments: '{"s":"t"}' } },
                  { id: 'same', function: { name: 'probe', arguments: { s: 'u' } } },
                ],
              },
            },
          ],
        },
      },
    ]);
    const reply = await transport(fetch).send({ prompt: 'hi' });
    expect(reply.calls.map((c) => c.arguments)).toEqual(['{"s":"t"}', '{"s":"u"}']);
    expect(new Set(reply.calls.map((c) => c.id)).size).toBe(2);
    expect(reply.calls[0]?.id).toBe('same');
  });

  it('reads content null or an array of parts as text', async () => {
    const { fetch } = fake([
      {
        body: {
          choices: [
            {
              message: {
                content: [
                  { type: 'text', text: 'a' },
                  { type: 'text', text: 'b' },
                ],
              },
            },
          ],
        },
      },
    ]);
    expect((await transport(fetch).send({ prompt: 'hi' })).text).toBe('ab');
  });
});

describe('ChatTransport history', () => {
  it('pushes tool messages after the assistant message, with the image line', async () => {
    const { request, fetch } = fake([
      {
        body: {
          choices: [
            {
              message: {
                content: 'calling',
                tool_calls: [{ id: 'c1', function: { name: 'probe', arguments: '{}' } }],
              },
            },
          ],
        },
      },
      { body: { choices: [{ message: { content: 'done' } }] } },
    ]);
    const chat = transport(fetch);
    const first = await chat.send({ prompt: 'hi' });
    const results: ToolReturn[] = [
      {
        call: first.calls[0] as ToolCall,
        blocks: [
          { type: 'text', text: 'one' },
          { type: 'image', mimeType: 'image/png', data: 'AAAA' },
        ],
      },
    ];
    await chat.send({ results });
    const messages = sentBody(request, 1).messages as Record<string, unknown>[];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: 'calling',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'probe', arguments: '{}' } }],
    });
    expect(messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: 'one\n[image omitted: this model reads text only]',
    });
  });

  it('answers an empty tool result with No result.', async () => {
    const { request, fetch } = fake([
      {
        body: {
          choices: [
            {
              message: { tool_calls: [{ id: 'c1', function: { name: 'probe', arguments: '{}' } }] },
            },
          ],
        },
      },
      { body: { choices: [{ message: { content: 'done' } }] } },
    ]);
    const chat = transport(fetch);
    const first = await chat.send({ prompt: 'hi' });
    await chat.send({ results: [{ call: first.calls[0] as ToolCall, blocks: [] }] });
    const messages = sentBody(request, 1).messages as Record<string, unknown>[];
    expect(messages[3]).toMatchObject({ role: 'tool', content: 'No result.' });
  });

  it('strips think text from the history but not from the reply', async () => {
    const { request, fetch } = fake([
      {
        body: {
          choices: [{ message: { content: '<think>plan it</think>Visible reply.' } }],
          usage: { prompt_tokens: 5, completion_tokens: 9 },
        },
      },
      { body: { choices: [{ message: { content: 'next' } }] } },
    ]);
    const chat = transport(fetch);
    const first = await chat.send({ prompt: 'hi' });
    expect(first.text).toBe('<think>plan it</think>Visible reply.');
    expect(first.usage).toEqual({ input: 5, cached: 0, output: 9 });
    await chat.send({ prompt: 'again' });
    const messages = sentBody(request, 1).messages as Record<string, unknown>[];
    expect(messages[2]).toMatchObject({ role: 'assistant', content: 'Visible reply.' });
  });

  it('strips an unclosed think block that starts the reply to empty history content', async () => {
    const { request, fetch } = fake([
      { body: { choices: [{ message: { content: '<think>still thinking' } }] } },
      { body: { choices: [{ message: { content: 'next' } }] } },
    ]);
    const chat = transport(fetch);
    await chat.send({ prompt: 'hi' });
    await chat.send({ prompt: 'again' });
    const messages = sentBody(request, 1).messages as Record<string, unknown>[];
    expect(messages[2]).toMatchObject({ role: 'assistant', content: '' });
  });

  it('keeps prose that mentions the think tags byte for byte in the history', async () => {
    const prose =
      'Qwen wraps reasoning in <think> tags and ends it with </think>; I answer plainly.';
    const { request, fetch } = fake([
      { body: { choices: [{ message: { content: prose } }] } },
      { body: { choices: [{ message: { content: 'next' } }] } },
    ]);
    const chat = transport(fetch);
    await chat.send({ prompt: 'hi' });
    await chat.send({ prompt: 'again' });
    const messages = sentBody(request, 1).messages as Record<string, unknown>[];
    expect(messages[2]).toMatchObject({ role: 'assistant', content: prose });
  });

  it('keeps literal think tags inside tool-call arguments unchanged', async () => {
    const args = '{"s":"<think>x</think>"}';
    const { request, fetch } = fake([
      {
        body: {
          choices: [
            {
              message: {
                content: 'calling',
                tool_calls: [{ id: 'c1', function: { name: 'probe', arguments: args } }],
              },
            },
          ],
        },
      },
      { body: { choices: [{ message: { content: 'done' } }] } },
    ]);
    const chat = transport(fetch);
    const first = await chat.send({ prompt: 'hi' });
    await chat.send({ results: [{ call: first.calls[0] as ToolCall, blocks: [] }] });
    const messages = sentBody(request, 1).messages as Record<string, unknown>[];
    expect(messages[2]).toMatchObject({
      tool_calls: [{ function: { name: 'probe', arguments: args } }],
    });
  });

  it('keeps every earlier message of the history, unchanged, at the start of the next request', async () => {
    const { request, fetch } = fake([
      { body: { choices: [{ message: { content: 'first' } }] } },
      { body: { choices: [{ message: { content: 'second' } }] } },
    ]);
    const chat = transport(fetch);
    await chat.send({ prompt: 'hi' });
    await chat.send({ prompt: 'again' });
    const first = sentBody(request, 0).messages as Record<string, unknown>[];
    const second = sentBody(request, 1).messages as Record<string, unknown>[];
    expect(first[0]).toEqual({ role: 'system', content: 'You are the mind.' });
    expect(second.slice(0, first.length)).toEqual(first);
    expect(second.length).toBe(first.length + 2);
  });
});

describe('ChatTransport errors', () => {
  it('HTTP 500 throws a fixed message with no part of the body', async () => {
    const { fetch } = fake([{ status: 500, body: 'secret-body-text' }]);
    const err = await transport(fetch)
      .send({ prompt: 'hi' })
      .catch((e: Error) => e);
    expect(err).toMatchObject({
      reason: 'transport_error',
      message: 'The model server returned HTTP 500.',
    });
    expect(String((err as Error).message)).not.toContain('secret');
  });

  it('a body that is not JSON throws the unreadable message', async () => {
    const { fetch } = fake([{ body: 'not json {' }]);
    await expect(transport(fetch).send({ prompt: 'hi' })).rejects.toThrow(
      'The model server sent a reply the kit could not read.',
    );
  });

  it('a reply with no choices message throws the unreadable message', async () => {
    const { fetch } = fake([{ body: { choices: [] } }]);
    await expect(transport(fetch).send({ prompt: 'hi' })).rejects.toThrow('could not read');
  });

  it('a null entry in tool_calls throws the unreadable message', async () => {
    const { fetch } = fake([{ body: { choices: [{ message: { tool_calls: [null] } }] } }]);
    await expect(transport(fetch).send({ prompt: 'hi' })).rejects.toThrow('could not read');
  });

  it('finish_reason length together with a tool call throws', async () => {
    const { fetch } = fake([
      {
        body: {
          choices: [
            {
              finish_reason: 'length',
              message: { tool_calls: [{ id: 'c', function: { name: 'probe', arguments: '{' } }] },
            },
          ],
        },
      },
    ]);
    await expect(transport(fetch).send({ prompt: 'hi' })).rejects.toThrow('cut the reply short');
  });
});

describe('ChatTransport in the loop', () => {
  it('calls a tool, then answers; ends is_error false with summed usage', async () => {
    const { fetch } = fake([
      {
        body: {
          choices: [
            {
              message: {
                content: '',
                tool_calls: [{ id: 'c1', function: { name: 'probe', arguments: '{}' } }],
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 7 },
        },
      },
      {
        body: {
          choices: [{ message: { content: 'all done' } }],
          usage: { prompt_tokens: 150, completion_tokens: 3 },
        },
      },
    ]);
    const calls: Record<string, unknown>[] = [];
    const tool: Tool = {
      name: 'probe',
      description: 'test',
      parameters: {},
      async call(args) {
        calls.push(args);
        return [{ type: 'text', text: 'ok' }];
      },
    };
    const items: Item[] = [];
    await runLoop({
      transport: transport(fetch),
      prompt: 'hello',
      maxTurns: 5,
      tools: [tool],
      emit: (item) => items.push(item),
      costSource: 'not_metered_local',
    });
    expect(calls).toEqual([{}]);
    expect(items.at(-1)).toMatchObject({
      type: 'result',
      is_error: false,
      num_turns: 2,
      usage: { input_tokens: 250, cached_input_tokens: 0, output_tokens: 10 },
    });
  });
});

type Msg = Record<string, unknown>;
const STUB = '[older result removed to make room]';
const BIG = 'x'.repeat(150);

/** The estimate of a request as the transport counts it: every message, then the tool list. */
function estimateOf(messages: Msg[]): number {
  const total = messages.reduce(
    (sum, m) => sum + estimateTokens(JSON.stringify(m)) + MESSAGE_OVERHEAD,
    0,
  );
  return total + estimateTokens(JSON.stringify([TOOL]));
}

/** The probe tool answers with `size` characters. */
function probeTool(size: number): Tool {
  return {
    name: 'probe',
    description: 'test',
    parameters: {},
    async call() {
      return [{ type: 'text', text: 'x'.repeat(size) }];
    },
  };
}

/**
 * A fake server that asks for the probe tool `calls` times, then answers. Each reply reports
 * `prompt_tokens` as `promptOf` says of the raw estimate of the request it received.
 */
function toolServer(calls: number, promptOf?: (raw: number) => number) {
  let n = 0;
  return vi.fn<Fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Msg[] };
    const usage = promptOf ? { prompt_tokens: promptOf(estimateOf(body.messages)) } : undefined;
    const reply =
      n < calls
        ? {
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  content: '',
                  tool_calls: [{ id: `c${n}`, function: { name: 'probe', arguments: '{}' } }],
                },
              },
            ],
          }
        : { choices: [{ message: { content: 'done' } }] };
    n++;
    return new Response(JSON.stringify(usage ? { ...reply, usage } : reply), { status: 200 });
  });
}

/** Runs the loop with a probe tool and the given config; the emitted items go to `items`. */
async function runScript(
  items: Item[],
  request: Fetch,
  config: Partial<ChatConfig>,
  size: number,
): Promise<void> {
  await runLoop({
    transport: new ChatTransport({
      baseUrl: BASE,
      model: 'qwen3:8b',
      instructions: 'You are the mind.',
      tools: [TOOL],
      request,
      ...config,
    }),
    prompt: 'hello',
    maxTurns: 50,
    tools: [probeTool(size)],
    emit: (item) => items.push(item),
    costSource: 'not_metered_local',
  });
}

/** The parsed body of every request the fake received. */
function bodies(request: ReturnType<typeof toolServer>): { messages: Msg[]; max_tokens: number }[] {
  return request.mock.calls.map(
    (c) =>
      JSON.parse(String((c[1] as RequestInit).body)) as { messages: Msg[]; max_tokens: number },
  );
}

/** True when every tool message follows an assistant message that asked for its id. */
function noOrphans(messages: Msg[]): boolean {
  let asked = new Set<unknown>();
  for (const m of messages) {
    if (m.role === 'assistant') {
      const calls = (m.tool_calls as { id: string }[] | undefined) ?? [];
      asked = new Set(calls.map((c) => c.id));
    }
    if (m.role === 'tool' && !asked.has(m.tool_call_id)) return false;
  }
  return true;
}

describe('ChatTransport budget', () => {
  it('keeps every request within the budget, the head and the last four turns, and stubs the oldest results', async () => {
    const request = toolServer(10);
    await runScript([], request, { contextTokens: 1200 }, 150);
    const sent = bodies(request);
    for (const body of sent) expect(estimateOf(body.messages)).toBeLessThanOrEqual(900);
    const last = sent.at(-1)?.messages ?? [];
    expect(last.slice(0, 2)).toEqual([
      { role: 'system', content: 'You are the mind.' },
      { role: 'user', content: 'hello' },
    ]);
    expect(last.slice(2, 6).map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant', 'tool']);
    expect(last.slice(-8).map((m) => m.role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
      'tool',
    ]);
    const tools = last.filter((m) => m.role === 'tool');
    expect(tools.slice(0, 2).map((m) => m.content)).toEqual([BIG, BIG]);
    expect(tools.slice(-4).map((m) => m.content)).toEqual([BIG, BIG, BIG, BIG]);
    for (const m of tools.slice(2, -4)) expect(m.content).toBe(STUB);
    expect(tools.some((m) => m.content === STUB)).toBe(true);
  });

  it('never leaves a tool message without the assistant message that asked for it', async () => {
    const request = toolServer(20);
    await runScript([], request, { contextTokens: 1200 }, 150);
    for (const body of bodies(request)) {
      expect(estimateOf(body.messages)).toBeLessThanOrEqual(900);
      expect(noOrphans(body.messages)).toBe(true);
    }
  });

  it('throws context_too_small when the system prompt alone is larger than the budget', async () => {
    const request = toolServer(3);
    const items: Item[] = [];
    await expect(
      runScript(items, request, { contextTokens: 1200, instructions: 'x'.repeat(3000) }, 150),
    ).rejects.toThrow('The waking no longer fits the declared context size.');
    expect(request).not.toHaveBeenCalled();
    expect(items.at(-1)).toMatchObject({
      type: 'result',
      is_error: true,
      stop_reason: 'context_too_small',
    });
  });

  it('a reported prompt size above the estimate raises the scale, capped at 3; a lower one never lowers it below 1', async () => {
    const finalCount = async (factor: number, contextTokens: number): Promise<number> => {
      const request = toolServer(12, (raw) => raw * factor);
      await runScript([], request, { contextTokens }, 150);
      return (bodies(request).at(-1)?.messages ?? []).length;
    };
    // Budget 3000: two system and user messages, then 12 exchanges of two messages each, nothing trimmed.
    const full = await finalCount(1, 4000);
    expect(full).toBe(26);
    expect(await finalCount(3, 4000)).toBeLessThan(full);
    // The scale is capped at 3, so a factor of 10 trims exactly as 3 does.
    expect(await finalCount(10, 4000)).toBe(await finalCount(3, 4000));
    // Budget 900: scale 1 trims. A scale of 0.5 would fit the same history, so the floor at 1 must keep the trim.
    const trimmed = await finalCount(1, 1200);
    expect(trimmed).toBeLessThan(26);
    expect(await finalCount(0.5, 1200)).toBe(trimmed);
  });

  it('with only two tail turns left to fit, trims the third and fourth newest exchanges and does not throw', async () => {
    const big = 'x'.repeat(200);
    const request = toolServer(12);
    await runScript([], request, { contextTokens: 1200 }, 200);
    const sent = bodies(request);
    for (const body of sent) expect(estimateOf(body.messages)).toBeLessThanOrEqual(900);
    const tools = (sent.at(-1)?.messages ?? []).filter((m) => m.role === 'tool');
    expect(tools.slice(0, 2).map((m) => m.content)).toEqual([big, big]);
    expect(tools.slice(-2).map((m) => m.content)).toEqual([big, big]);
    expect(tools.slice(2, -2).some((m) => m.content === big)).toBe(false);
  });

  it('keepTurns below 1 is kept at 1, so the newest exchange with its results is never trimmed', async () => {
    const request = toolServer(10);
    await runScript([], request, { contextTokens: 1200, keepTurns: 0 }, 150);
    for (const body of bodies(request)) {
      expect(estimateOf(body.messages)).toBeLessThanOrEqual(900);
      expect(noOrphans(body.messages)).toBe(true);
    }
    const last = (bodies(request).at(-1)?.messages ?? []).filter((m) => m.role === 'tool');
    expect(last.at(-1)?.content).toBe(BIG);
  });

  it('sends max_tokens equal to the reserve', async () => {
    for (const [contextTokens, reserve] of [
      [1200, 300],
      [8000, 2000],
    ] as const) {
      const request = toolServer(0);
      await runScript([], request, { contextTokens }, 150);
      expect(bodies(request)[0]?.max_tokens).toBe(reserve);
    }
  });

  it('without contextTokens nothing is trimmed or changed', async () => {
    const request = toolServer(10);
    await runScript([], request, {}, 600);
    const last = bodies(request).at(-1);
    const tools = (last?.messages ?? []).filter((m) => m.role === 'tool');
    expect(tools.length).toBe(10);
    for (const m of tools) expect(m.content).toBe('x'.repeat(600));
    expect(last?.max_tokens).toBe(2048);
  });
});
