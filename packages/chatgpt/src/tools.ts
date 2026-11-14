import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { record } from './auth.ts';
import { fileTools, textOutput } from './files.ts';
import type { Tool } from './responses.ts';

/** Preserve world images without fetching model-supplied URLs or treating tool text as instructions. */
export function toolOutput(answer: unknown): unknown {
  if (!record(answer) || !Array.isArray(answer.content)) return textOutput('No result.');
  const blocks: unknown[] = [];
  for (const c of answer.content) {
    if (!record(c)) continue;
    if (c.type === 'text' && typeof c.text === 'string')
      blocks.push({ type: 'input_text', text: c.text });
    if (
      c.type === 'image' &&
      typeof c.data === 'string' &&
      c.data.length <= 8 * 1024 * 1024 &&
      ['image/png', 'image/jpeg', 'image/webp'].includes(String(c.mimeType)) &&
      /^[A-Za-z0-9+/=\r\n]+$/.test(c.data)
    ) {
      blocks.push({
        type: 'input_image',
        image_url: `data:${String(c.mimeType)};base64,${c.data}`,
        detail: 'auto',
      });
    }
  }
  return blocks.length ? blocks : textOutput('No result.');
}

export async function connectTools(
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<{ tools: Tool[]; close(): Promise<void> }> {
  const clients: Client[] = [];
  const tools = fileTools(root);
  const close = async (): Promise<void> => {
    await Promise.allSettled(clients.map((c) => c.close()));
  };
  const add = async (client: Client, prefix: string): Promise<void> => {
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      for (const t of page.tools) {
        const name = `${prefix}${t.name}`;
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || tools.some((other) => other.name === name))
          throw new Error('duplicate tool');
        tools.push({
          name,
          description: t.description ?? t.name,
          parameters: t.inputSchema,
          async call(args) {
            return toolOutput(
              await client.callTool({ name: t.name, arguments: args }, undefined, {
                timeout: 300_000,
              }),
            );
          },
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
  };
  try {
    const world = new Client({ name: 'geldar-chatgpt', version: '0.1.0' });
    clients.push(world);
    const url = new URL(env.GELDAR_MCP_URL ?? '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('world address');
    await world.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: { Authorization: `Bearer ${env.GELDAR_MCP_TOKEN ?? ''}` },
          redirect: 'error',
        },
      }),
    );
    await add(world, '');
    for (const [command, prefix, args] of [
      ['geldar-memory', 'memory_', ['--root', root]],
      ['geldar-git', 'git_', ['mcp', '--root', root]],
    ] as const) {
      const client = new Client({ name: 'geldar-chatgpt', version: '0.1.0' });
      clients.push(client);
      // Fixed executables and a fresh environment: these servers never receive ChatGPT credentials.
      await client.connect(
        new StdioClientTransport({
          command,
          args: [...args],
          stderr: 'ignore',
          env: {
            PATH: env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
            HOME: '/tmp',
            GELDAR_MODE: 'play',
          },
        }),
      );
      await add(client, prefix);
    }
    return { tools, close };
  } catch (err) {
    await close();
    throw err;
  }
}
