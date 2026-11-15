import { describe, expect, it } from 'vitest';
import { runLoop } from './loop.ts';
import type { Completion, ToolReturn, Transport } from './transport.ts';
import type { Item, Tool } from './types.ts';

type Send = Parameters<Transport['send']>[0];

/** A transport that replays the scripted completions in order and records every send. */
function scripted(replies: Completion[]): { transport: Transport; sends: Send[] } {
  const sends: Send[] = [];
  const transport: Transport = {
    async send(input) {
      sends.push(input);
      const next = replies.shift();
      if (!next) throw new Error('no scripted reply');
      return next;
    },
  };
  return { transport, sends };
}

/** A transport that always asks for the same call. */
function alwaysCall(): Transport {
  return {
    async send() {
      return { text: '', calls: [{ id: 'c1', name: 'probe', arguments: '{}' }] };
    },
  };
}

/** A tool that records its arguments and returns one text block. */
function probe(log: Record<string, unknown>[]): Tool {
  return {
    name: 'probe',
    description: 'test',
    parameters: {},
    async call(args) {
      log.push(args);
      return [{ type: 'text', text: 'ok' }];
    },
  };
}

function run(transport: Transport, tools: Tool[], items: Item[], maxTurns = 5): Promise<void> {
  return runLoop({
    transport,
    prompt: 'hello',
    maxTurns,
    tools,
    emit: (item) => items.push(item),
    costSource: 'not_metered_local',
  });
}

describe('runLoop', () => {
  it('a text-only reply is one assistant item and one result', async () => {
    const items: Item[] = [];
    const { transport } = scripted([{ text: 'hi there', calls: [] }]);
    await run(transport, [], items);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: 'assistant' });
    expect(items[1]).toMatchObject({
      type: 'result',
      is_error: false,
      num_turns: 1,
      result: 'hi there',
    });
  });

  it('runs one tool call with the parsed arguments and sends the answer back', async () => {
    const items: Item[] = [];
    const seen: Record<string, unknown>[] = [];
    const { transport, sends } = scripted([
      { text: '', calls: [{ id: 'c1', name: 'probe', arguments: '{"q":1}' }] },
      { text: 'done', calls: [] },
    ]);
    await run(transport, [probe(seen)], items);
    expect(seen).toEqual([{ q: 1 }]);
    expect(sends[0]).toEqual({ prompt: 'hello' });
    const second = sends[1] as { results: ToolReturn[] };
    expect(second.results).toHaveLength(1);
    expect(second.results[0]?.call).toEqual({ id: 'c1', name: 'probe', arguments: '{"q":1}' });
    expect(second.results[0]?.blocks).toEqual([{ type: 'text', text: 'ok' }]);
    expect(items.at(-1)).toMatchObject({ type: 'result', num_turns: 2 });
  });

  it('answers unknown tools, bad JSON, an empty id and a throwing tool with the fixed text', async () => {
    const items: Item[] = [];
    const executed: Record<string, unknown>[] = [];
    const thrower: Tool = {
      name: 'boom',
      description: 'test',
      parameters: {},
      async call() {
        throw new Error('server body');
      },
    };
    const spy: Tool = { ...probe(executed), name: 'spy' };
    const { transport, sends } = scripted([
      {
        text: '',
        calls: [
          { id: 'a', name: 'missing', arguments: '{}' },
          { id: 'b', name: 'spy', arguments: 'not json' },
          { id: '', name: 'spy', arguments: '{}' },
          { id: 'd', name: 'boom', arguments: '{}' },
        ],
      },
      { text: 'end', calls: [] },
    ]);
    await run(transport, [spy, thrower], items);
    expect(executed).toEqual([]);
    const answer = sends[1] as { results: ToolReturn[] };
    expect(answer.results).toHaveLength(4);
    for (const r of answer.results)
      expect(r.blocks).toEqual([{ type: 'text', text: 'That tool call could not be completed.' }]);
  });

  it('rejects with MAX_TURNS and emits an error result with stop_reason max_turns', async () => {
    const items: Item[] = [];
    await expect(run(alwaysCall(), [], items, 1)).rejects.toThrow(/MAX_TURNS/);
    expect(items.at(-1)).toMatchObject({
      type: 'result',
      is_error: true,
      stop_reason: 'max_turns',
    });
  });

  it('sums the usage of two completions into the result', async () => {
    const items: Item[] = [];
    const { transport } = scripted([
      {
        text: '',
        calls: [{ id: 'c1', name: 'probe', arguments: '{}' }],
        usage: { input: 10, cached: 4, output: 3 },
      },
      { text: 'done', calls: [], usage: { input: 5, cached: 1, output: 2 } },
    ]);
    await run(transport, [probe([])], items);
    expect(items.at(-1)).toMatchObject({
      type: 'result',
      usage: { input_tokens: 15, cached_input_tokens: 5, output_tokens: 5 },
    });
  });

  it('repeats an earlier text on a later item with no text and keeps it as the result text', async () => {
    const items: Item[] = [];
    const { transport } = scripted([
      { text: 'first words', calls: [{ id: 'c1', name: 'probe', arguments: '{}' }] },
      { text: '', calls: [] },
    ]);
    await run(transport, [probe([])], items);
    const second = items[1] as { message: { content: Record<string, unknown>[] } };
    expect(second.message.content[0]).toEqual({ type: 'text', text: 'first words' });
    expect(items.at(-1)).toMatchObject({ type: 'result', result: 'first words' });
  });
});
