import { describe, expect, it } from 'vitest';
import { runLoop } from './loop.ts';
import { type SanityParams, VETO_TEXT } from './sanity.ts';
import type { Completion, ToolCall, ToolReturn, Transport } from './transport.ts';
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

const reply = (...calls: ToolCall[]): Completion => ({ text: '', calls });
const call = (id: string, name: string, args: string): ToolCall => ({ id, name, arguments: args });

/** The status answer: night, outdoors and no shelter, with no digit in it. */
const NIGHT = '{"night":true,"outdoors":true,"shelter_carried":false}';

/** The world: a status tool and an act tool that records the arguments it ran with. */
function world(ran: Record<string, unknown>[]): Tool[] {
  return [
    {
      name: 'status',
      description: 'The status of the agent.',
      parameters: { type: 'object', properties: {} },
      async call() {
        return [{ type: 'text', text: NIGHT }];
      },
    },
    {
      name: 'act',
      description: 'Act on the world.',
      parameters: {
        type: 'object',
        properties: { program: { type: 'string' }, distance: { type: 'number' } },
        required: ['program'],
      },
      async call(args) {
        ran.push(args);
        return [{ type: 'text', text: 'done' }];
      },
    },
  ];
}

const params = (common_sense: SanityParams['common_sense']): SanityParams => ({
  v: 1,
  life: 'life-a',
  common_sense,
  rolls: false,
  arm: 'none',
});

const STATUS = call('s1', 'status', '{}');
const TRAVEL = call('t1', 'act', '{"program":"travel","distance":65}');
const WALK = call('w1', 'act', '{"program":"walk"}');
const INVALID = call('i1', 'act', '{}');

/** Runs one scripted waking with the given replies and options. */
async function run(
  replies: Completion[],
  opts: { sanity?: SanityParams | null; validate?: boolean } = {},
): Promise<{ items: Item[]; ran: Record<string, unknown>[]; sends: Send[]; error?: unknown }> {
  const items: Item[] = [];
  const ran: Record<string, unknown>[] = [];
  const { transport, sends } = scripted(replies);
  try {
    await runLoop({
      transport,
      prompt: 'hello',
      maxTurns: 10,
      tools: world(ran),
      emit: (item) => items.push(item),
      costSource: 'not_metered_local',
      ...opts,
    });
  } catch (error) {
    return { items, ran, sends, error };
  }
  return { items, ran, sends };
}

const vetoes = (items: Item[]) => items.filter((i) => i.type === 'sanity');

/** The tool answers the model received in one send. */
function answers(send: Send | undefined): string[] {
  if (!send || !('results' in send)) return [];
  return send.results.flatMap((r: ToolReturn) =>
    r.blocks.map((b) => (b.type === 'text' ? b.text : '')),
  );
}

describe('runLoop with the sanity veto', () => {
  it('valid and no hit: the call runs', async () => {
    const out = await run([reply(STATUS), reply(WALK), reply()], { sanity: params(3) });
    expect(out.ran).toEqual([{ program: 'walk' }]);
    expect(vetoes(out.items)).toEqual([]);
  });

  it('valid, hit, caught: vetoed once, the next valid call without a hit runs', async () => {
    const out = await run([reply(STATUS), reply(TRAVEL), reply(WALK), reply()], {
      sanity: params(3),
    });
    expect(out.ran).toEqual([{ program: 'walk' }]);
    expect(vetoes(out.items)).toEqual([
      expect.objectContaining({ type: 'sanity', check: 'night_exposure' }),
    ]);
    expect(answers(out.sends[2])).toEqual([VETO_TEXT.night_exposure]);
  });

  it('valid, hit, roll missed: the call runs and no veto is emitted', async () => {
    const out = await run([reply(STATUS), reply(TRAVEL), reply()], { sanity: params(2) });
    expect(out.ran).toEqual([{ program: 'travel', distance: 65 }]);
    expect(vetoes(out.items)).toEqual([]);
  });

  it('a second hit in the same decision is waived: the call runs', async () => {
    const out = await run([reply(STATUS), reply(TRAVEL), reply(TRAVEL), reply()], {
      sanity: params(3),
    });
    expect(out.ran).toEqual([{ program: 'travel', distance: 65 }]);
    expect(vetoes(out.items)).toHaveLength(1);
  });

  it('the second call invalid after a veto falls back: the waking ends, no third call', async () => {
    const out = await run([reply(STATUS), reply(TRAVEL), reply(INVALID)], {
      sanity: params(3),
      validate: true,
    });
    expect(out.error).toMatchObject({
      message: expect.stringContaining('did not produce a valid tool call'),
    });
    expect(out.ran).toEqual([]);
    expect(out.sends).toHaveLength(3);
  });

  it('an invalid call then a valid hit: the corrective retry uses the allowance, so the hit runs', async () => {
    const out = await run([reply(STATUS), reply(INVALID), reply(TRAVEL), reply()], {
      sanity: params(3),
      validate: true,
    });
    expect(out.ran).toEqual([{ program: 'travel', distance: 65 }]);
    expect(vetoes(out.items)).toEqual([]);
  });

  it('a vetoed decision takes exactly two model calls', async () => {
    const out = await run([reply(STATUS), reply(TRAVEL), reply()], { sanity: params(3) });
    // The prompt send, the status answer, the veto answer: the veto's decision is the two replies after the status.
    expect(out.sends).toHaveLength(3);
    expect(out.ran).toEqual([]);
  });

  it('the veto answer and every tool answer the model receives carry no digit and none of the scan words', async () => {
    const out = await run([reply(STATUS), reply(TRAVEL), reply(WALK), reply()], {
      sanity: params(3),
    });
    const all = out.sends.flatMap((s) => answers(s));
    expect(all).toContain(VETO_TEXT.night_exposure);
    for (const text of all) {
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/\b(roll|dice|score|sheet)\b/i);
    }
  });

  it('null params: the call runs and nothing is emitted, as before', async () => {
    const out = await run([reply(STATUS), reply(TRAVEL), reply()], { sanity: null });
    expect(out.ran).toEqual([{ program: 'travel', distance: 65 }]);
    expect(vetoes(out.items)).toEqual([]);
  });
});
