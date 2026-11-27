import { MindError } from './errors.ts';
import { record } from './record.ts';
import {
  isObservation,
  pendingCall,
  type SanityParams,
  VETO_TEXT,
  vetoOrRun,
  viewFromStatus,
} from './sanity.ts';
import type { Block, Completion, ToolCall, ToolReturn, Transport, Usage } from './transport.ts';
import type { Item, Tool } from './types.ts';
import { compileTools } from './validate.ts';

/** The most model calls one decision may take: a corrective retry or a sanity veto spends one of them (HC-23a). */
const DECISION_CALLS = 2;

/** One round of the mind: the transport it talks through, the prompt and the tools it may call. */
export interface LoopRound {
  transport: Transport;
  prompt: string;
  maxTurns: number;
  tools: Tool[];
  emit(item: Item): void;
  costSource: string;
  /** Checks each call against its tool's schema first and gives one corrective retry (default false). */
  validate?: boolean;
  /** The sanity veto's parameters (HC-23a). Absent or null: every call the loop accepts runs, as before. */
  sanity?: SanityParams | null;
}

/** The text of a tool answer: its text blocks, joined. */
function textOf(blocks: Block[]): string {
  return blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
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

/**
 * The answer that refuses an invalid call, or null when the call may run. An unknown tool, arguments
 * that are not JSON or not an object, and a schema error are all invalid.
 */
function invalidAnswer(
  call: ToolCall,
  byName: Map<string, Tool>,
  check: (name: string, args: Record<string, unknown>) => string | null,
): string | null {
  if (!byName.has(call.name)) return `There is no tool named ${call.name}.`;
  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    return `Your call to ${call.name} was not valid: arguments are not JSON. Send the call again with corrected arguments.`;
  }
  if (!record(args))
    return `Your call to ${call.name} was not valid: arguments must be a JSON object. Send the call again with corrected arguments.`;
  const problem = check(call.name, args);
  if (problem === null) return null;
  return `Your call to ${call.name} was not valid: ${problem}. Send the call again with corrected arguments.`;
}

/** The generic round: sends the prompt, runs the calls each reply asks for and emits the stream items. */
export async function runLoop(round: LoopRound): Promise<void> {
  const byName = new Map(round.tools.map((t) => [t.name, t]));
  const check = round.validate ? compileTools(round.tools) : null;
  // Invalid calls in a row: the first gets a corrective answer, the second ends the round.
  let invalidStreak = 0;
  const total: Usage = { input: 0, cached: 0, output: 0 };
  // The usage the owned loop's result line reports (input is uncached).
  const reported = () => ({
    input_tokens: total.input,
    cached_input_tokens: total.cached,
    output_tokens: total.output,
  });
  let turns = 0;
  let text = '';
  // The decision in progress (HC-23a): the model replies it has taken, and whether its veto is spent.
  let chain = 0;
  let vetoedInDecision = false;
  // The text of the last status or look answer, which the sanity veto reads.
  let observed: string | null = null;
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
      chain++;
      // Whether this reply was corrected or vetoed: such a decision goes on to another model call.
      let flagged = false;
      const results: ToolReturn[] = [];
      for (const call of completion.calls) {
        const refused = check ? invalidAnswer(call, byName, check) : null;
        if (refused === null) {
          invalidStreak = 0;
          const sanity = round.sanity ?? null;
          if (sanity) {
            const judged = vetoOrRun(
              pendingCall(call),
              viewFromStatus(observed),
              sanity,
              turns,
              { used: chain - 1, max: DECISION_CALLS },
              vetoedInDecision,
            );
            if (judged.veto !== null) {
              vetoedInDecision = true;
              flagged = true;
              round.emit({ type: 'sanity', check: judged.veto, roll: judged.roll.at(-1) });
              results.push({ call, blocks: [{ type: 'text', text: VETO_TEXT[judged.veto] }] });
              continue;
            }
          }
          const blocks = await runCall(call, byName);
          if (sanity && isObservation(call.name)) observed = textOf(blocks);
          results.push({ call, blocks });
          continue;
        }
        flagged = true;
        invalidStreak++;
        // A corrective answer needs one more model call; with none left the round ends, as HC-11 defines.
        if (invalidStreak >= 2 || chain >= DECISION_CALLS)
          throw new MindError(
            'The model did not produce a valid tool call after a correction.',
            'invalid_tool_calls',
          );
        results.push({ call, blocks: [{ type: 'text', text: refused }] });
      }
      // A reply with no correction and no veto ends the decision: its calls have run.
      if (!flagged) {
        chain = 0;
        vetoedInDecision = false;
      }
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
