/** One piece of a tool answer: text, or an image as base64 data. */
export type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string };

/** The global fetch signature, injected by transports so tests can replace it. */
export type Fetch = typeof fetch;

/** A tool as offered to the model: name, description and a JSON schema for its arguments. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A call the model asked for. `arguments` is the raw JSON text the model produced. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** The answer to one call, sent back to the model on the next send. */
export interface ToolReturn {
  call: ToolCall;
  blocks: Block[];
}

/** Uncached input, cached input and output tokens for one completion. */
export interface Usage {
  input: number;
  cached: number;
  output: number;
}

/** One model reply: its text, the calls it asked for and optionally its usage. */
export interface Completion {
  text: string;
  calls: ToolCall[];
  usage?: Usage;
}

/** Sends the prompt (first turn) or the tool answers (later turns) to one harness and returns its reply. */
export interface Transport {
  send(input: { prompt: string } | { results: ToolReturn[] }): Promise<Completion>;
}
