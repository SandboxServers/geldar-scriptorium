import {
  type Block,
  type Completion,
  type Item,
  record,
  type ToolCall,
  type ToolReturn,
  type ToolSpec,
  type Transport,
} from '@geldar/scriptorium-mind-loop';
import { type Fetch, RESOURCE } from './auth.ts';
import { completed } from './responses.ts';

/** What a Responses transport is built from: the model, its instructions, the tools and the token source. */
export interface ResponsesOptions {
  model: string;
  instructions: string;
  tools: ToolSpec[];
  access(): Promise<string>;
  request?: Fetch | undefined;
}

/** A count from the wire: a finite number, or 0. */
function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Maps tool blocks to Responses content: text as input_text, images as data URLs with detail auto. */
function toWire(blocks: Block[]): Item[] {
  return blocks.map((b) =>
    b.type === 'text'
      ? { type: 'input_text', text: b.text }
      : { type: 'input_image', image_url: `data:${b.mimeType};base64,${b.data}`, detail: 'auto' },
  );
}

/** A call's name. A call from another namespace keeps its namespace, so the tool table lookup fails. */
function callName(item: Item): string {
  const name = typeof item.name === 'string' ? item.name : '';
  return item.namespace === undefined || item.namespace === 'geldar'
    ? name
    : `${String(item.namespace)}.${name}`;
}

/** The ChatGPT Responses API behind the mind-loop Transport: it keeps the history and replays it each send. */
export class ResponsesTransport implements Transport {
  private readonly opts: ResponsesOptions;
  private readonly input: Item[] = [];

  constructor(opts: ResponsesOptions) {
    this.opts = opts;
  }

  async send(msg: { prompt: string } | { results: ToolReturn[] }): Promise<Completion> {
    if ('prompt' in msg) {
      this.input.push({ role: 'user', content: msg.prompt });
    } else {
      for (const r of msg.results) {
        if (r.call.id)
          this.input.push({
            type: 'function_call_output',
            call_id: r.call.id,
            output: toWire(r.blocks),
          });
      }
    }
    const request = this.opts.request ?? fetch;
    const access = await this.opts.access();
    const res = await request(`${RESOURCE}/responses`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10 * 60_000),
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.opts.model,
        instructions: this.opts.instructions,
        input: this.input,
        store: false,
        stream: true,
        include: ['reasoning.encrypted_content'],
        parallel_tool_calls: false,
        tools: [
          {
            type: 'namespace',
            name: 'geldar',
            description: 'Your world and your memories.',
            tools: this.opts.tools.map((t) => ({
              type: 'function',
              name: t.name,
              description: t.description,
              parameters: t.parameters,
              strict: false,
            })),
          },
        ],
      }),
    });
    const result = await completed(res);
    // Replaying output, including encrypted reasoning, is required with store:false.
    const output = (result.output as unknown[]).filter(record);
    this.input.push(...output);
    let text = '';
    for (const item of output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const block of item.content)
          if (record(block) && block.type === 'output_text' && typeof block.text === 'string')
            text = block.text;
      }
    }
    const calls: ToolCall[] = output
      .filter((i) => i.type === 'function_call')
      .map((c) => ({
        id: String(c.call_id ?? ''),
        name: callName(c),
        arguments: String(c.arguments),
      }));
    const raw: unknown = result.usage;
    const usage: Item = record(raw) ? raw : {};
    const details: Item = record(usage.input_tokens_details) ? usage.input_tokens_details : {};
    const cached = count(details.cached_tokens);
    return {
      text,
      calls,
      usage: {
        input: Math.max(0, count(usage.input_tokens) - cached),
        cached,
        output: count(usage.output_tokens),
      },
    };
  }
}
