import { describe, expect, it, vi } from 'vitest';
import type { Fetch } from './auth.ts';
import { ResponsesTransport } from './transport.ts';

/** One completed SSE reply carrying the given output items and usage. */
function sse(output: unknown[], usage: unknown = {}): Response {
  const event = { type: 'response.completed', response: { status: 'completed', output, usage } };
  return new Response(`data: ${JSON.stringify(event)}\n\n`);
}

/** A fake fetch that answers in order and records each request body. */
function fake(replies: Response[]) {
  const bodies: { input: Record<string, unknown>[] }[] = [];
  const request = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return replies.shift() ?? sse([]);
  });
  return { bodies, request: request as unknown as Fetch };
}

const make = (request: Fetch) =>
  new ResponsesTransport({
    model: 'm',
    instructions: 'i',
    tools: [],
    access: async () => 'tok',
    request,
  });

describe('ResponsesTransport', () => {
  it('sends an image block as input_image with a data URL and detail auto', async () => {
    const { bodies, request } = fake([
      sse([{ type: 'function_call', call_id: 'c1', name: 'look', arguments: '{}' }]),
      sse([]),
    ]);
    const t = make(request);
    await t.send({ prompt: 'go' });
    await t.send({
      results: [
        {
          call: { id: 'c1', name: 'look', arguments: '{}' },
          blocks: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }],
        },
      ],
    });
    expect(bodies[1]?.input.at(-1)).toEqual({
      type: 'function_call_output',
      call_id: 'c1',
      output: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'auto' }],
    });
  });

  it('returns a call from another namespace with a qualified name so the lookup fails', async () => {
    const { request } = fake([
      sse([
        { type: 'function_call', call_id: 'c2', namespace: 'other', name: 'read', arguments: '{}' },
      ]),
    ]);
    const completion = await make(request).send({ prompt: 'x' });
    expect(completion.calls).toEqual([{ id: 'c2', name: 'other.read', arguments: '{}' }]);
  });

  it('does not send a result for a call with an empty id', async () => {
    const { bodies, request } = fake([
      sse([{ type: 'function_call', call_id: '', name: 'look', arguments: '{}' }]),
      sse([]),
    ]);
    const t = make(request);
    await t.send({ prompt: 'go' });
    await t.send({
      results: [
        { call: { id: '', name: 'look', arguments: '{}' }, blocks: [{ type: 'text', text: 'x' }] },
      ],
    });
    expect(bodies[1]?.input.some((i) => i.type === 'function_call_output')).toBe(false);
  });

  it('maps usage to uncached input, cached input and output, never below 0 for input', async () => {
    const reply = (usage: unknown) =>
      fake([sse([{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }], usage)])
        .request;
    const counted = await make(
      reply({ input_tokens: 10, output_tokens: 3, input_tokens_details: { cached_tokens: 4 } }),
    ).send({ prompt: 'x' });
    expect(counted).toEqual({ text: 'hi', calls: [], usage: { input: 6, cached: 4, output: 3 } });
    const clamped = await make(
      reply({ input_tokens: 2, output_tokens: 1, input_tokens_details: { cached_tokens: 5 } }),
    ).send({ prompt: 'x' });
    expect(clamped.usage).toEqual({ input: 0, cached: 5, output: 1 });
  });
});
