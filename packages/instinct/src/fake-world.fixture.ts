// A fake world for the instinct tests: an MCP server on 127.0.0.1 that answers the two tools the step calls, `wait`
// and `act`. Replies come from a script (one list per tool, consumed in order, the last reply repeats); every call is
// recorded. Test-only: nothing here is imported by product code.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export interface WorldCall {
  name: string;
  args: Record<string, unknown>;
}

/** The replies for each tool, as the text the world would return. */
export interface WorldScript {
  wait?: string[];
  act?: string[];
}

export interface FakeWorld {
  /** The MCP endpoint, `http://127.0.0.1:<port>/p/life1`. */
  url: string;
  /** Every tool call the world received, in order. */
  calls: WorldCall[];
  close(): Promise<void>;
}

const TOOLS = ['wait', 'act'] as const;

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? undefined : JSON.parse(text);
}

/** A stateless MCP server: each request gets its own server and transport over the shared script and call log. */
function serverFor(script: WorldScript, calls: WorldCall[]): Server {
  const queues: Record<string, string[]> = {
    wait: [...(script.wait ?? [])],
    act: [...(script.act ?? [])],
  };
  const server = new Server(
    { name: 'fake-world', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((name) => ({ name, inputSchema: { type: 'object' as const } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    calls.push({ name, args });
    const queue = queues[name];
    const text = queue && queue.length > 1 ? (queue.shift() as string) : (queue?.[0] ?? '{}');
    return { content: [{ type: 'text', text }] };
  });
  return server;
}

/** Starts the fake world on a free port of 127.0.0.1. Close it when the test ends. */
export async function startFakeWorld(script: WorldScript = {}): Promise<FakeWorld> {
  const calls: WorldCall[] = [];
  const http = createServer(async (req, res) => {
    try {
      const body = await readBody(req);
      const server = serverFor(script, calls);
      // No session id: each request is one exchange, so the server needs no state between requests.
      const transport = new StreamableHTTPServerTransport({});
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) res.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/p/life1`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      }),
  };
}
