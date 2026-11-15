import { describe, expect, it, vi } from 'vitest';
import { ChatTransport } from './chat.ts';
import { runLoop } from './loop.ts';
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
