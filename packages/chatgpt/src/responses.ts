import { type Item, record, runLoop, type Tool } from '@geldar/scriptorium-mind-loop';
import { ChatGPTError, type Fetch } from './auth.ts';
import { ResponsesTransport } from './transport.ts';

export type { Item, Tool };

/** SSE is framed by blank lines, independent of network chunks or CRLF boundaries. */
export async function completed(response: Response): Promise<Item> {
  if (!response.ok)
    throw new ChatGPTError(
      `ChatGPT request failed (HTTP ${response.status}). Check plan access and usage limits.`,
    );
  if (!response.body) throw new ChatGPTError('ChatGPT returned an empty stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let frame = '';
  const event = (data: string): Item | null => {
    if (!data || data === '[DONE]') return null;
    const e: unknown = JSON.parse(data);
    if (!record(e)) return null;
    if (e.type === 'response.failed' || e.type === 'response.incomplete' || e.type === 'error') {
      throw new ChatGPTError('ChatGPT did not complete the round.');
    }
    if (e.type !== 'response.completed') return null;
    if (
      !record(e.response) ||
      e.response.status !== 'completed' ||
      !Array.isArray(e.response.output)
    ) {
      throw new ChatGPTError('Invalid ChatGPT completion.');
    }
    return e.response;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (pending.length + frame.length > 16 * 1024 * 1024)
        throw new ChatGPTError('ChatGPT stream exceeded its limit.');
      let at = pending.indexOf('\n');
      while (at !== -1) {
        const line = pending.slice(0, at).replace(/\r$/, '');
        pending = pending.slice(at + 1);
        if (line === '') {
          const result = event(frame.trimEnd());
          frame = '';
          if (result) return result;
        } else if (line.startsWith('data:')) frame += `${line.slice(5).trimStart()}\n`;
        at = pending.indexOf('\n');
      }
      if (done) break;
    }
    throw new ChatGPTError('ChatGPT disconnected before response.completed.');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export interface Round {
  model: string;
  instructions: string;
  prompt: string;
  maxTurns: number;
  tools: Tool[];
  access(): Promise<string>;
  emit(item: Item): void;
  request?: Fetch;
}

/** No shell, arbitrary URLs, vendor tools or host file tools are exposed to this mind. */
export async function runRound(round: Round): Promise<void> {
  const transport = new ResponsesTransport({
    model: round.model,
    instructions: round.instructions,
    tools: round.tools,
    access: round.access,
    request: round.request,
  });
  await runLoop({
    transport,
    prompt: round.prompt,
    maxTurns: round.maxTurns,
    tools: round.tools,
    emit: round.emit,
    costSource: 'unavailable_subscription',
  });
}
