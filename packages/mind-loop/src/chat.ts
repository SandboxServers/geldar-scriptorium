import { MindError } from './errors.ts';
import type {
  Block,
  Completion,
  Fetch,
  ToolCall,
  ToolReturn,
  ToolSpec,
  Transport,
} from './transport.ts';

/** What the chat transport needs: where the server is, which model, the fixed system text and the tools. */
export interface ChatConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  instructions: string;
  tools: ToolSpec[];
  maxOutputTokens?: number;
  request?: Fetch;
}

/** One entry of the history resent on every request (OpenAI-style chat messages). */
type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      tool_calls?: {
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

const IMAGE_OMITTED = '[image omitted: this model reads text only]';
const THINK_CLOSED = /^\s*<think>[\s\S]*?<\/think>/;
const THINK_OPEN = /^\s*<think>[\s\S]*$/;

/**
 * Removes Qwen-style reasoning text so the history keeps only the visible reply. Only a think block
 * that starts the content is removed, so prose that merely mentions the tags is kept as written.
 */
function stripThink(text: string): string {
  let rest = text;
  let next = rest.replace(THINK_CLOSED, '');
  while (next !== rest) {
    rest = next;
    next = rest.replace(THINK_CLOSED, '');
  }
  rest = rest.replace(THINK_OPEN, '');
  return rest === text ? text : rest.trim();
}

/** Reads a message's content: a string, null, or an array of parts (their text parts, concatenated). */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && typeof part.text === 'string' ? part.text : '',
      )
      .join('');
  }
  return '';
}

/** Turns the tool answer blocks into the text the model reads: images are replaced by a fixed line. */
function resultText(blocks: Block[]): string {
  const text = blocks
    .map((block) => (block.type === 'text' ? block.text : IMAGE_OMITTED))
    .join('\n');
  return text === '' ? 'No result.' : text;
}

/**
 * The chat completions transport for the local harness: non-streaming, plain function tools, one
 * history that only grows. The key stays in a private field and never reaches an error or a log.
 */
export class ChatTransport implements Transport {
  private readonly messages: ChatMessage[];
  private readonly url: string;
  private readonly config: Omit<ChatConfig, 'apiKey'>;
  readonly #apiKey: string | undefined;
  private readonly request: Fetch;
  private callCounter = 0;

  constructor(config: ChatConfig) {
    const { apiKey, ...rest } = config;
    this.config = rest;
    this.messages = [{ role: 'system', content: config.instructions }];
    this.url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.#apiKey = apiKey;
    this.request = config.request ?? ((input, init) => fetch(input, init));
  }

  async send(input: { prompt: string } | { results: ToolReturn[] }): Promise<Completion> {
    if ('prompt' in input) {
      this.messages.push({ role: 'user', content: input.prompt });
    } else {
      for (const result of input.results) {
        this.messages.push({
          role: 'tool',
          tool_call_id: result.call.id,
          content: resultText(result.blocks),
        });
      }
    }
    const reply = await this.post();
    return this.complete(reply);
  }

  /** One non-streaming request; errors name the status or the fixed reason, never the body. */
  private async post(): Promise<unknown> {
    const { tools } = this.config;
    const res = await this.request(this.url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10 * 60_000),
      headers: {
        'Content-Type': 'application/json',
        ...(this.#apiKey ? { Authorization: `Bearer ${this.#apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: this.messages,
        stream: false,
        max_tokens: this.config.maxOutputTokens ?? 2048,
        ...(tools.length > 0
          ? {
              tools: tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
            }
          : {}),
      }),
    });
    if (!res.ok)
      throw new MindError(`The model server returned HTTP ${res.status}.`, 'transport_error');
    try {
      return await res.json();
    } catch {
      throw unreadable();
    }
  }

  /** Reads one reply, appends its assistant message to the history and returns the completion. */
  private complete(reply: unknown): Completion {
    const choice = (reply as { choices?: { message?: unknown; finish_reason?: unknown }[] })
      ?.choices?.[0];
    const message = choice?.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== 'object') throw unreadable();

    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (choice?.finish_reason === 'length' && rawCalls.length > 0) {
      throw new MindError('The model server cut the reply short.', 'transport_error');
    }

    const seen = new Set<string>();
    const calls: ToolCall[] = rawCalls.map((raw) => {
      if (!raw || typeof raw !== 'object') throw unreadable();
      const call = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
      const id = this.callId(call.id, seen);
      const args = call.function?.arguments;
      return {
        id,
        name: String(call.function?.name ?? ''),
        arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      };
    });

    const text = contentText(message.content);
    this.messages.push({
      role: 'assistant',
      content: stripThink(text),
      ...(calls.length > 0
        ? {
            tool_calls: calls.map((c) => ({
              id: c.id,
              type: 'function' as const,
              function: { name: c.name, arguments: c.arguments },
            })),
          }
        : {}),
    });

    const usage =
      reply && typeof (reply as { usage?: unknown }).usage === 'object'
        ? (reply as { usage: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage
        : undefined;
    return {
      text,
      calls,
      ...(usage
        ? {
            usage: {
              input: count(usage.prompt_tokens),
              cached: 0,
              output: count(usage.completion_tokens),
            },
          }
        : {}),
    };
  }

  /** The server's string id when it is present and unused in this reply, else the next `call_${n}`. */
  private callId(id: unknown, seen: Set<string>): string {
    if (typeof id === 'string' && id !== '' && !seen.has(id)) {
      seen.add(id);
      return id;
    }
    let next: string;
    do {
      next = `call_${++this.callCounter}`;
    } while (seen.has(next));
    seen.add(next);
    return next;
  }
}

/** The fixed error for a reply the kit cannot read. */
function unreadable(): MindError {
  return new MindError('The model server sent a reply the kit could not read.', 'transport_error');
}

/** A usage count, or 0 when the server did not send a number. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
