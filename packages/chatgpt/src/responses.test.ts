import { describe, expect, it, vi } from 'vitest';
import type { Fetch } from './auth.ts';
import { completed, type Item, runRound, type Tool } from './responses.ts';
import { toolOutput } from './tools.ts';

const response = (output: Item[], usage = {}) => ({
  type: 'response.completed',
  response: { status: 'completed', output, usage },
});
function sse(events: unknown[], chunkSize = 7): Response {
  const bytes = new TextEncoder().encode(
    events.map((e) => `event: message\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join(''),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunkSize)
          controller.enqueue(bytes.slice(i, i + chunkSize));
        controller.close();
      },
    }),
  );
}

describe('ChatGPT mind tool loop', () => {
  it('handles split SSE frames and refuses disconnects, failed/incomplete results and HTTP errors', async () => {
    expect((await completed(sse([response([])]))).status).toBe('completed');
    await expect(
      completed(sse([{ type: 'response.output_text.delta', delta: 'unfinished' }])),
    ).rejects.toThrow('disconnected');
    for (const type of ['response.failed', 'response.incomplete', 'error']) {
      await expect(completed(sse([{ type, error: 'secret body' }]))).rejects.toThrow(
        'did not complete',
      );
    }
    await expect(completed(new Response('secret body', { status: 429 }))).rejects.toThrow(
      'HTTP 429',
    );
    await expect(
      completed(sse([{ type: 'response.completed', response: { status: 'failed', output: [] } }])),
    ).rejects.toThrow('Invalid');
  });

  it('replays tool results and encrypted reasoning with the supported subscription contract', async () => {
    const emitted: Item[] = [];
    const bodies: Item[] = [];
    const call = vi.fn(async () =>
      toolOutput({
        content: [
          { type: 'text', text: 'you see a tree' },
          { type: 'image', mimeType: 'image/png', data: 'AAAA' },
        ],
      }),
    );
    const tools: Tool[] = [
      { name: 'look', description: 'Look around.', parameters: { type: 'object' }, call },
    ];
    const request = vi.fn(async (_url, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private-access');
      bodies.push(JSON.parse(String(init?.body)) as Item);
      return bodies.length === 1
        ? sse([
            response([
              { type: 'reasoning', id: 'r', encrypted_content: 'encrypted-reasoning', summary: [] },
              {
                type: 'function_call',
                namespace: 'geldar',
                name: 'look',
                call_id: 'call-1',
                arguments: '{}',
              },
            ]),
          ])
        : sse([
            response([
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'I will rest.' }],
              },
            ]),
          ]);
    }) as unknown as Fetch;
    await runRound({
      model: 'account-model',
      instructions: 'Stay in the world.',
      prompt: 'Wake up.',
      maxTurns: 3,
      tools,
      access: async () => 'private-access',
      emit: (item) => emitted.push(item),
      request,
    });
    expect(call).toHaveBeenCalledExactlyOnceWith({});
    const first = bodies[0];
    expect(first).toMatchObject({
      model: 'account-model',
      store: false,
      stream: true,
      parallel_tool_calls: false,
    });
    expect(first?.tools).toEqual([expect.objectContaining({ type: 'namespace', name: 'geldar' })]);
    for (const key of [
      'previous_response_id',
      'max_output_tokens',
      'temperature',
      'conversation',
      'background',
    ])
      expect(first).not.toHaveProperty(key);
    expect(bodies[1]?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ encrypted_content: 'encrypted-reasoning' }),
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call-1',
          output: [
            { type: 'input_text', text: 'you see a tree' },
            { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'auto' },
          ],
        }),
      ]),
    );
    expect(JSON.stringify(bodies)).not.toContain('private-access');
    expect(emitted.at(-1)).toMatchObject({
      type: 'result',
      is_error: false,
      num_turns: 2,
      cost_source: 'unavailable_subscription',
    });
  });

  it('never executes unknown tools or another namespace, and bounds the number of model turns', async () => {
    const call = vi.fn(async () => 'must not run');
    const emitted: Item[] = [];
    const request = vi.fn(async () =>
      sse([
        response([
          {
            type: 'function_call',
            namespace: 'outside',
            name: 'look',
            call_id: 'x',
            arguments: '{}',
          },
          {
            type: 'function_call',
            namespace: 'geldar',
            name: 'shell',
            call_id: 'y',
            arguments: '{"command":"cat /cli-home/chatgpt/credentials.json"}',
          },
          { type: 'function_call', name: 'look', call_id: 'z', arguments: 'not-json' },
        ]),
      ]),
    ) as unknown as Fetch;
    await expect(
      runRound({
        model: 'account-model',
        instructions: '',
        prompt: '',
        maxTurns: 1,
        tools: [{ name: 'look', description: '', parameters: {}, call }],
        access: async () => 'secret',
        emit: (item) => emitted.push(item),
        request,
      }),
    ).rejects.toThrow('MAX_TURNS');
    expect(call).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    expect(emitted.at(-1)?.is_error).toBe(true);
  });

  it('keeps MCP error text as tool output and never fetches a tool-supplied resource URL', () => {
    expect(
      toolOutput({
        isError: true,
        content: [
          { type: 'text', text: 'Action failed: blocked.' },
          { type: 'resource_link', uri: 'https://untrusted.test/secret' },
          { type: 'image', mimeType: 'text/html', data: 'AAAA' },
        ],
      }),
    ).toEqual([{ type: 'input_text', text: 'Action failed: blocked.' }]);
  });
});
