import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GOOD, LONG_CONTROL, LONG_CONTROL_TEXT, SURROGATE } from './run-summary.fixtures.ts';
import { cleanText, RunSummaryBuilder } from './run-summary.ts';
import { SessionParser, type StreamRecord } from './session-stream.ts';

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

function parseAll(text: string): StreamRecord[] {
  const parser = new SessionParser();
  return text.split('\n').flatMap((line) => parser.feed(line));
}

// Feeds text in fixed-size chunks through a line splitter that holds the partial line between chunks.
function parseChunks(text: string, size: number): StreamRecord[] {
  const parser = new SessionParser();
  const out: StreamRecord[] = [];
  let rest = '';
  for (let at = 0; at < text.length; at += size) {
    const parts = (rest + text.slice(at, at + size)).split('\n');
    rest = parts.pop() ?? '';
    for (const part of parts) out.push(...parser.feed(part));
  }
  out.push(...parser.feed(rest));
  return out;
}

type TurnRecord = Extract<StreamRecord, { kind: 'turn' }>;

function turns(records: StreamRecord[]): TurnRecord[] {
  return records.filter((r): r is TurnRecord => r.kind === 'turn');
}

describe('fixtures parse to the expected records', () => {
  it('session 1: one turn with a tool call, its result, a second turn and the result line', () => {
    expect(parseAll(fixture('session-1-basic.jsonl'))).toEqual([
      { kind: 'init', model: 'claude-sonnet-5-5' },
      {
        kind: 'turn',
        index: 0,
        id: 'msg_01',
        model: 'claude-sonnet-5-5',
        usage: { input: 120, output: 35, cacheRead: 4000, cacheCreation: 300 },
        stopReason: 'tool_use',
        parentToolUseId: null,
        text: 'I will read the notes file.',
        reasoning: '',
        toolUses: [{ id: 'toolu_01', name: 'Read', input: { file_path: 'memory/summary.md' } }],
      },
      {
        kind: 'tool_result',
        toolUseId: 'toolu_01',
        isError: false,
        content: '# Recent days\n\nDay 1 passed quietly.\n',
        parentToolUseId: null,
      },
      {
        kind: 'turn',
        index: 1,
        id: 'msg_02',
        model: 'claude-sonnet-5-5',
        usage: { input: 140, output: 12, cacheRead: 4300, cacheCreation: 0 },
        stopReason: 'end_turn',
        parentToolUseId: null,
        text: 'The bees were quiet. Nothing to add.',
        reasoning: '',
        toolUses: [],
      },
      {
        kind: 'result',
        isError: false,
        turns: 2,
        costUsd: 0.0123,
        usage: { input: 260, output: 47, cacheRead: 8300, cacheCreation: 300 },
        subtype: 'success',
      },
    ]);
  });

  it('session 2: subagent lines carry parent_tool_use_id; array tool results are flattened', () => {
    const records = parseAll(fixture('session-2-subagent.jsonl'));
    const usage = (input: number, output: number, cacheRead: number) => ({
      input,
      output,
      cacheRead,
      cacheCreation: 0,
    });
    expect(records).toEqual([
      { kind: 'init', model: 'claude-sonnet-5-5' },
      {
        kind: 'turn',
        index: 0,
        id: 'msg_10',
        model: 'claude-sonnet-5-5',
        usage: usage(90, 20, 1000),
        stopReason: 'tool_use',
        parentToolUseId: null,
        text: '',
        reasoning: '',
        toolUses: [{ id: 'toolu_task', name: 'Task', input: { description: 'survey the hive' } }],
      },
      {
        kind: 'turn',
        index: 1,
        id: 'msg_11',
        model: 'claude-sonnet-5-5',
        usage: usage(50, 9, 600),
        stopReason: 'tool_use',
        parentToolUseId: 'toolu_task',
        text: 'Checking the hive.',
        reasoning: '',
        toolUses: [{ id: 'toolu_sub_read', name: 'Read', input: { file_path: 'hives/3.md' } }],
      },
      {
        kind: 'tool_result',
        toolUseId: 'toolu_sub_read',
        isError: false,
        content: 'Hive 3: strong.',
        parentToolUseId: 'toolu_task',
      },
      {
        kind: 'turn',
        index: 2,
        id: 'msg_12',
        model: 'claude-sonnet-5-5',
        usage: usage(60, 6, 650),
        stopReason: 'end_turn',
        parentToolUseId: 'toolu_task',
        text: 'Hive 3 is strong.',
        reasoning: '',
        toolUses: [],
      },
      {
        kind: 'tool_result',
        toolUseId: 'toolu_task',
        isError: false,
        content: 'Hive 3 is strong.',
        parentToolUseId: null,
      },
      {
        kind: 'turn',
        index: 3,
        id: 'msg_13',
        model: 'claude-sonnet-5-5',
        usage: usage(70, 5, 1100),
        stopReason: 'end_turn',
        parentToolUseId: null,
        text: 'The survey is done.',
        reasoning: '',
        toolUses: [],
      },
      {
        kind: 'result',
        isError: false,
        turns: 4,
        costUsd: 0.0345,
        usage: { input: 270, output: 40, cacheRead: 3350, cacheCreation: 0 },
        subtype: 'success',
      },
    ]);
  });

  it('session 3: a rejected rate limit, then an error result with no usage', () => {
    expect(parseAll(fixture('session-3-rate-limit.jsonl'))).toEqual([
      { kind: 'init', model: 'claude-sonnet-5-5' },
      {
        kind: 'turn',
        index: 0,
        id: 'msg_20',
        model: 'claude-sonnet-5-5',
        usage: null,
        stopReason: 'end_turn',
        parentToolUseId: null,
        text: 'Checking the calendar.',
        reasoning: '',
        toolUses: [],
      },
      {
        kind: 'rate_limit',
        status: 'rejected',
        limitKind: 'five_hour',
        resetsAt: 1767225600,
      },
      {
        kind: 'result',
        isError: true,
        turns: 1,
        costUsd: 0,
        usage: null,
        subtype: 'error_during_execution',
      },
    ]);
  });

  it('session 4: a thinking block is kept, an image result is a length marker, unknown blocks are skipped', () => {
    expect(parseAll(fixture('session-4-image-thinking.jsonl'))).toEqual([
      { kind: 'init', model: 'claude-sonnet-5-5' },
      {
        kind: 'turn',
        index: 0,
        id: 'msg_30',
        model: 'claude-sonnet-5-5',
        usage: { input: 200, output: 30, cacheRead: 0, cacheCreation: 500 },
        stopReason: 'tool_use',
        parentToolUseId: null,
        text: 'Let me look at the photo.',
        reasoning: 'The hive photo should show the frames.',
        toolUses: [{ id: 'toolu_img', name: 'Read', input: { file_path: 'photos/hive.png' } }],
      },
      {
        kind: 'tool_result',
        toolUseId: 'toolu_img',
        isError: false,
        content: 'photo attached\n[image 240 base64 chars]',
        parentToolUseId: null,
      },
      {
        kind: 'turn',
        index: 1,
        id: 'msg_31',
        model: 'claude-sonnet-5-5',
        usage: { input: 240, output: 8, cacheRead: 700, cacheCreation: 0 },
        stopReason: 'end_turn',
        parentToolUseId: null,
        text: 'The frames look strong.',
        reasoning: '',
        toolUses: [],
      },
      {
        kind: 'result',
        isError: false,
        turns: 2,
        costUsd: 0.031,
        usage: { input: 440, output: 38, cacheRead: 700, cacheCreation: 500 },
        subtype: 'success',
      },
    ]);
  });
});

describe('chunking and bad input', () => {
  it('gives the same records for any chunk split of each fixture', () => {
    for (const name of [
      'session-1-basic.jsonl',
      'session-2-subagent.jsonl',
      'session-3-rate-limit.jsonl',
      'session-4-image-thinking.jsonl',
    ]) {
      const text = fixture(name);
      for (const size of [1, 2, 7, 50, 333, text.length]) {
        expect(parseChunks(text, size)).toEqual(parseAll(text));
      }
    }
  });

  it('yields nothing for blank, malformed, non-object and unknown lines, and never throws', () => {
    const parser = new SessionParser();
    expect(parser.feed('')).toEqual([]);
    expect(parser.feed('   ')).toEqual([]);
    expect(parser.feed('{"type":"assistant","message":{"content":[')).toEqual([]);
    expect(parser.feed('[{"type":"result"}]')).toEqual([]);
    expect(parser.feed('"just a string"')).toEqual([]);
    expect(parser.feed('{"type":"stream_event","event":{}}')).toEqual([]);
    expect(parser.feed('{"type":"assistant","message":"not an object"}')).toEqual([]);
  });

  it('handles a 5 MB line: valid JSON yields its record, malformed JSON yields nothing', () => {
    const pad = 'x'.repeat(5 * 1024 * 1024);
    const parser = new SessionParser();
    expect(parser.feed(`{"type":"result","is_error":false,"pad":"${pad}`)).toEqual([]);
    const records = parser.feed(
      `{"type":"result","is_error":false,"num_turns":3,"total_cost_usd":1.5,"pad":"${pad}"}`,
    );
    expect(records).toEqual([
      {
        kind: 'result',
        isError: false,
        turns: 3,
        costUsd: 1.5,
        usage: null,
        subtype: null,
      },
    ]);
  });

  it('keeps no base64 body from an image result', () => {
    const text = fixture('session-4-image-thinking.jsonl');
    expect(text).toContain('QUJD');
    const result = parseAll(text).find((r) => r.kind === 'tool_result');
    expect(result?.kind).toBe('tool_result');
    if (result?.kind !== 'tool_result') return;
    expect(result.content).not.toContain('QUJD');
    expect(result.content.length).toBeLessThan(100);
  });
});

describe('agreement with the run summary', () => {
  it('RunSummaryBuilder and SessionParser agree on turns, cost and tool counts for session 1', () => {
    const text = fixture('session-1-basic.jsonl');
    const builder = new RunSummaryBuilder();
    for (const line of text.split('\n')) builder.addLine(line);
    const summary = builder.summary();

    const records = parseAll(text);
    const result = records.find((r) => r.kind === 'result');
    const tools: Record<string, number> = {};
    for (const turn of turns(records)) {
      for (const tool of turn.toolUses) {
        tools[tool.name] = (tools[tool.name] ?? 0) + 1;
      }
    }

    expect(result?.kind).toBe('result');
    if (result?.kind !== 'result') return;
    expect(turns(records)).toHaveLength(summary.turns);
    expect(result.turns).toBe(summary.turns);
    expect(result.costUsd).toBe(summary.cost);
    expect(result.isError).toBe(summary.is_error);
    expect(tools).toEqual(summary.tools);
  });

  it('a parsed turn text, cut the same way, equals the run summary last_text', () => {
    for (const [text, raw] of [
      [GOOD, '  All done.  '],
      [LONG_CONTROL, LONG_CONTROL_TEXT],
      [SURROGATE, `${'a'.repeat(1499)}\u{1F600}tail`],
    ] as const) {
      const builder = new RunSummaryBuilder();
      for (const line of text.split('\n')) builder.addLine(line);
      const last = turns(parseAll(text)).at(-1);
      expect(last?.kind).toBe('turn');
      if (last?.kind !== 'turn') return;
      expect(last.text).toBe(raw);
      expect(cleanText(last.text)).toBe(builder.summary().last_text);
    }
  });
});
