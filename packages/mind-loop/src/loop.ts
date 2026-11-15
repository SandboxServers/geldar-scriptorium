import { MindError } from './errors.ts';
import { record } from './record.ts';
import type { Block, Completion, ToolCall, ToolReturn, Transport, Usage } from './transport.ts';
import type { Item, Tool } from './types.ts';

/** One round of the mind: the transport it talks through, the prompt and the tools it may call. */
export interface LoopRound {
  transport: Transport;
  prompt: string;
  maxTurns: number;
  tools: Tool[];
  emit(item: Item): void;
  costSource: string;
}

/** Adds one completion's usage to the running total. */
function addUsage(total: Usage, usage: Usage | undefined): void {
  if (!usage) return;
  total.input += usage.input;
  total.cached += usage.cached;
  total.output += usage.output;
}

/** Runs one call. Unknown tools, bad arguments, a missing id or a throwing tool get the fixed answer. */
async function runCall(call: ToolCall, byName: Map<string, Tool>): Promise<Block[]> {
  const tool = byName.get(call.name);
  try {
    const args: unknown = JSON.parse(call.arguments);
    if (!tool || !record(args) || !call.id) throw new Error('invalid call');
    // Tool.call still returns unknown until the Responses transport moves behind the interface (HC-06b);
    // the answer is passed through as blocks here, cast once.
    return (await tool.call(args)) as Block[];
  } catch {
    return [{ type: 'text', text: 'That tool call could not be completed.' }];
  }
}

/** The generic round: sends the prompt, runs the calls each reply asks for and emits the stream items. */
export async function runLoop(round: LoopRound): Promise<void> {
  const byName = new Map(round.tools.map((t) => [t.name, t]));
  const total: Usage = { input: 0, cached: 0, output: 0 };
  // The usage the owned loop's result line reports (input is uncached).
  const reported = () => ({
    input_tokens: total.input,
    cached_input_tokens: total.cached,
    output_tokens: total.output,
  });
  let turns = 0;
  let text = '';
  try {
    let completion: Completion = await round.transport.send({ prompt: round.prompt });
    while (true) {
      turns++;
      addUsage(total, completion.usage);
      if (completion.text) text = completion.text;
      round.emit({
        type: 'assistant',
        message: {
          content: [
            ...(text ? [{ type: 'text', text }] : []),
            ...completion.calls.map((c) => ({
              type: 'tool_use',
              name: c.name,
              id: c.id,
              input: c.arguments,
            })),
          ],
        },
        ...(completion.usage
          ? {
              usage: {
                input_tokens: completion.usage.input,
                cached_input_tokens: completion.usage.cached,
                output_tokens: completion.usage.output,
              },
            }
          : {}),
      });
      if (completion.calls.length === 0) {
        round.emit({
          type: 'result',
          is_error: false,
          num_turns: turns,
          total_cost_usd: 0,
          result: text,
          cost_source: round.costSource,
          usage: reported(),
        });
        return;
      }
      if (turns >= round.maxTurns)
        throw new MindError('The round reached GELDAR_RUN_MAX_TURNS.', 'max_turns');
      const results: ToolReturn[] = [];
      for (const call of completion.calls)
        results.push({ call, blocks: await runCall(call, byName) });
      completion = await round.transport.send({ results });
    }
  } catch (err) {
    round.emit({
      type: 'result',
      is_error: true,
      num_turns: turns,
      total_cost_usd: 0,
      cost_source: round.costSource,
      usage: reported(),
      stop_reason: err instanceof MindError ? err.reason : 'transport_error',
    });
    throw err;
  }
}
