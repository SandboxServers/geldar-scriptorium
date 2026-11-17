/**
 * Pure parser for the lines of `session-<n>.jsonl`: stream-json from the Claude CLI, or the ChatGPT
 * harness's equivalent. Telemetry and the turn records both read through here, so they cannot disagree.
 * No I/O and no clock: a caller feeds lines and gets records back. Text is kept in full; callers cut it.
 */

/** Token counts of one message or of a whole run. Every count defaults to 0 when absent. */
export interface StreamUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

/** One record per useful stream line. An unknown line or block produces nothing. */
export type StreamRecord =
  | { kind: 'init'; model: string | null }
  | {
      kind: 'turn';
      index: number;
      id: string | null;
      model: string | null;
      usage: StreamUsage | null;
      stopReason: string | null;
      parentToolUseId: string | null;
      text: string;
      reasoning: string;
      toolUses: Array<{ id: string; name: string; input: unknown }>;
    }
  | {
      kind: 'tool_result';
      toolUseId: string;
      isError: boolean;
      content: string;
      parentToolUseId: string | null;
    }
  | { kind: 'rate_limit'; status: string; limitKind: string | null; resetsAt: number | null }
  | {
      kind: 'result';
      isError: boolean;
      turns: number;
      costUsd: number;
      usage: StreamUsage | null;
      subtype: string | null;
    };

/** The only state kept between lines: how many assistant turns have been seen. */
export interface ParserState {
  turnIndex: number;
}

type Obj = Record<string, unknown>;

function isRecord(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function integerOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : 0;
}

function parseUsage(value: unknown): StreamUsage | null {
  if (!isRecord(value)) return null;
  return {
    input: finiteOrZero(value.input_tokens),
    output: finiteOrZero(value.output_tokens),
    cacheRead: finiteOrZero(value.cache_read_input_tokens),
    cacheCreation: finiteOrZero(value.cache_creation_input_tokens),
  };
}

// An image becomes its base64 length, never its bytes.
function imageMarker(part: Obj): string {
  const data = isRecord(part.source) ? part.source.data : undefined;
  return typeof data === 'string' ? `[image ${data.length} base64 chars]` : '[image]';
}

// A tool result body: a string as is; an array of blocks joined by newline (text kept, images marked).
function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === 'text' && typeof part.text === 'string') parts.push(part.text);
    else if (part.type === 'image') parts.push(imageMarker(part));
  }
  return parts.join('\n');
}

// A subagent line carries its parent's tool-use id; a top-level line has none.
function assistantRecords(line: Obj, state: ParserState): StreamRecord[] {
  const message = line.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  let text = '';
  let reasoning = '';
  const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
  for (const block of message.content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      text += block.text;
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      reasoning += block.thinking;
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      toolUses.push({ id: str(block.id) ?? '', name: block.name, input: block.input });
    }
  }
  const index = state.turnIndex;
  state.turnIndex += 1;
  return [
    {
      kind: 'turn',
      index,
      id: str(message.id),
      model: str(message.model),
      usage: parseUsage(message.usage),
      stopReason: str(message.stop_reason),
      parentToolUseId: str(line.parent_tool_use_id),
      text,
      reasoning,
      toolUses,
    },
  ];
}

// One record per tool_result block; the line's parent_tool_use_id is shared by all of them.
function userRecords(line: Obj): StreamRecord[] {
  const message = line.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  const parentToolUseId = str(line.parent_tool_use_id);
  const records: StreamRecord[] = [];
  for (const block of message.content) {
    if (!isRecord(block) || block.type !== 'tool_result') continue;
    records.push({
      kind: 'tool_result',
      toolUseId: str(block.tool_use_id) ?? '',
      isError: block.is_error === true,
      content: flattenContent(block.content),
      parentToolUseId,
    });
  }
  return records;
}

function rateLimitRecords(line: Obj): StreamRecord[] {
  const info = line.rate_limit_info;
  if (!isRecord(info)) return [];
  const at = info.resetsAt;
  return [
    {
      kind: 'rate_limit',
      status: str(info.status) ?? '',
      limitKind: str(info.rateLimitType),
      resetsAt: typeof at === 'number' && Number.isFinite(at) ? at : null,
    },
  ];
}

/**
 * Parses one line (without its newline). Blank lines, malformed JSON, JSON that is not an object and
 * unknown types yield []; this never throws. `state` is the only thing it changes (the turn counter).
 */
export function parseSessionLine(line: string, state: ParserState): StreamRecord[] {
  if (line.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  switch (parsed.type) {
    case 'system':
      return parsed.subtype === 'init' ? [{ kind: 'init', model: str(parsed.model) }] : [];
    case 'assistant':
      return assistantRecords(parsed, state);
    case 'user':
      return userRecords(parsed);
    case 'rate_limit_event':
      return rateLimitRecords(parsed);
    case 'result':
      return [
        {
          kind: 'result',
          isError: parsed.is_error === true,
          turns: integerOrZero(parsed.num_turns),
          costUsd: finiteOrZero(parsed.total_cost_usd),
          usage: parseUsage(parsed.usage),
          subtype: str(parsed.subtype),
        },
      ];
    default:
      return [];
  }
}

/** Feeds stream lines one at a time. Between calls it keeps only the turn counter; text is not retained. */
export class SessionParser {
  private readonly state: ParserState = { turnIndex: 0 };

  /** Parses one line (see parseSessionLine). */
  feed(line: string): StreamRecord[] {
    return parseSessionLine(line, this.state);
  }
}
