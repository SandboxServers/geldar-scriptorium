// An in-test stand-in for the Geldar world, until Wave 3 ships the real one.
// Test code: it is never copied into the kit image.
// Run directly (node test-world.ts) it listens on GELDAR_TEST_WORLD_PORT (default 80) and
// wants GELDAR_TEST_WORLD_TOKEN. Port 80 as uid 1000 works because Docker's default
// net.ipv4.ip_unprivileged_port_start is 0 inside a container.
import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export interface World {
  port: number;
  // The headers of every request that reached the server, in order (lower-case names).
  seen: http.IncomingHttpHeaders[];
  close(): Promise<void>;
}

function bearerOk(header: string | undefined, token: string): boolean {
  const want = Buffer.from(`Bearer ${token}`);
  const got = Buffer.from(header ?? '');
  return got.length === want.length && timingSafeEqual(got, want);
}

// A fresh server per request: stateless mode. `status` counts its own calls.
function buildServer(counter: { days: number }): McpServer {
  const server = new McpServer({ name: 'test-world', version: '0.1.0' });
  server.registerTool('status', { description: 'The day counter' }, async () => {
    counter.days += 1;
    return { content: [{ type: 'text', text: JSON.stringify({ day: counter.days }) }] };
  });
  server.registerTool('wait', { description: 'Returns at once, as on timeout' }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      content: [{ type: 'text', text: JSON.stringify({ events: [], wake_reason: 'timeout' }) }],
    };
  });
  return server;
}

export async function startWorld(options: {
  port: number;
  token: string;
  host?: string;
}): Promise<World> {
  const seen: http.IncomingHttpHeaders[] = [];
  const counter = { days: 0 };
  const httpServer = http.createServer((req, res) => {
    seen.push({ ...req.headers });
    if (!bearerOk(req.headers.authorization, options.token)) {
      res.writeHead(401, { 'content-type': 'text/plain' }).end('unauthorized');
      return;
    }
    if (!(req.url ?? '').startsWith('/p/')) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        const server = buildServer(counter);
        const transport = new StreamableHTTPServerTransport({
          // undefined means stateless; the SDK types leave it out under exactOptionalPropertyTypes
          sessionIdGenerator: undefined as unknown as () => string,
          enableJsonResponse: true,
        });
        res.on('close', () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        const text = Buffer.concat(chunks).toString('utf8');
        await transport.handleRequest(req, res, text === '' ? undefined : JSON.parse(text));
      })().catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host ?? '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;
  return {
    port,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer.closeAllConnections();
        httpServer.close(() => resolve());
      }),
  };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const token = process.env.GELDAR_TEST_WORLD_TOKEN;
  if (!token) {
    process.stderr.write('test-world: GELDAR_TEST_WORLD_TOKEN is not set\n');
    process.exitCode = 2;
  } else {
    const port = Number(process.env.GELDAR_TEST_WORLD_PORT ?? '80');
    await startWorld({ port, token, host: process.env.GELDAR_TEST_WORLD_HOST ?? '127.0.0.1' });
  }
}
