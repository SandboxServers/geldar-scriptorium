// The world link for the instinct step: one MCP client to the player's world, the same connection rules as the chatgpt
// tools (http or https only, no credentials in the URL, redirects refused). mind-loop's connectTools also starts the
// memory and git servers, so it is not reused here; HC-05 may absorb this file.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { BAD_CURSOR } from './observe.ts';

export interface WorldLink {
  call(name: string, args: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

const CALL_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 20_000;

/** Headers as mind-loop's worldHeaders builds them (read-only copy): bearer token, harness and model when valid. */
export function worldHeaders(env: {
  GELDAR_MCP_TOKEN?: string;
  GELDAR_HARNESS?: string;
  GELDAR_RUN_MODEL?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.GELDAR_MCP_TOKEN ?? ''}`,
  };
  const harness = env.GELDAR_HARNESS ?? '';
  if (/^(claude|chatgpt|local)$/.test(harness)) headers['X-Geldar-Harness'] = harness;
  const model = env.GELDAR_RUN_MODEL ?? '';
  if (/^[A-Za-z0-9._:/-]{1,64}$/.test(model)) headers['X-Geldar-Model'] = model;
  return headers;
}

function isTextBlock(value: unknown): value is { type: 'text'; text: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'text' &&
    typeof (value as { text?: unknown }).text === 'string'
  );
}

/**
 * The text of one tool answer: its text blocks joined by a newline (other blocks are dropped). An error answer throws
 * BAD_CURSOR when the text names bad_cursor, and otherwise 'world refused the call'. The refusal text is never echoed.
 */
export function replyText(answer: Record<string, unknown>): string {
  const content: unknown[] = Array.isArray(answer.content) ? answer.content : [];
  const text = content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join('\n');
  if (answer.isError) {
    throw new Error(/bad_cursor/.test(text) ? BAD_CURSOR : 'world refused the call');
  }
  return text;
}

/** Connects to the world. Throws on a bad address or a failed or slow connect; the caller maps that to no_world. */
export async function connectWorld(env: {
  GELDAR_MCP_URL?: string;
  GELDAR_MCP_TOKEN?: string;
  GELDAR_HARNESS?: string;
  GELDAR_RUN_MODEL?: string;
}): Promise<WorldLink> {
  const url = new URL(env.GELDAR_MCP_URL ?? '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('world address');
  }
  const client = new Client({ name: 'geldar-instinct', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: worldHeaders(env),
      redirect: 'error',
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('world connect timeout')), CONNECT_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    await client.close().catch(() => undefined);
    throw err;
  } finally {
    clearTimeout(timer);
  }
  return {
    async call(name, args) {
      const answer = await client.callTool({ name, arguments: args }, undefined, {
        timeout: CALL_TIMEOUT_MS,
      });
      return replyText(answer);
    },
    async close() {
      await client.close().catch(() => undefined);
    },
  };
}
