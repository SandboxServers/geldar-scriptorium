import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type HttpSpec, readMcpConfig, type ServerSpec } from './mcp-config.ts';
import type { Step } from './scenario.ts';

export interface RunOptions {
  root: string; // the player folder; the .mcp.json is read from here
  steps: Step[];
  env?: Record<string, string>; // added to every spawned server's environment (e.g. GELDAR_MODE)
  resolveCommand?: (spec: { command: string; args: string[] }) => {
    command: string;
    args: string[];
  };
}

// index is 1-based, the same n the CLI prints as "step <n>".
export interface StepResult {
  index: number;
  op: string;
  ok: boolean;
  text?: string;
  failure?: string;
}

function stringEntries(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// A fetch on node:http that honors HTTP_PROXY (Node's built-in fetch does not). With a proxy
// the request goes to the proxy with the absolute URL as its path; without one it is direct.
// Plain http only: https is refused.
export function proxyFetch(env: NodeJS.ProcessEnv = process.env): typeof fetch {
  return async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.protocol !== 'http:') {
      throw new Error(`the stub supports http urls only, not ${target.protocol}`);
    }
    const proxyText = env.HTTP_PROXY ?? env.http_proxy;
    const proxy = proxyText ? new URL(proxyText) : undefined;
    const headers = new Headers(init?.headers);
    headers.set('host', target.host);
    const body = typeof init?.body === 'string' ? init.body : undefined;
    if (body !== undefined) headers.set('content-length', String(Buffer.byteLength(body)));
    return new Promise<Response>((resolve, reject) => {
      const req = http.request(
        {
          host: proxy ? proxy.hostname : target.hostname,
          port: proxy ? proxy.port || 80 : target.port || 80,
          method: init?.method ?? 'GET',
          path: proxy ? target.href : `${target.pathname}${target.search}`,
          headers: Object.fromEntries(headers),
          signal: init?.signal ?? undefined,
        },
        (res) => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value !== undefined) responseHeaders.set(key, [value].flat().join(', '));
          }
          const status = res.statusCode ?? 502;
          const noBody = status === 204 || status === 205 || status === 304;
          resolve(
            new Response(noBody ? null : (Readable.toWeb(res) as ReadableStream), {
              status,
              ...(res.statusMessage ? { statusText: res.statusMessage } : {}),
              headers: responseHeaders,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  };
}

// Runs the steps in order against the player folder. Servers start on first use and are
// closed in the finally. The stub enforces nothing: only the step's own expectations decide.
export async function runScenario(options: RunOptions): Promise<StepResult[]> {
  const root = path.resolve(options.root);
  const results: StepResult[] = [];
  const clients = new Map<string, Client>();
  let specs: Record<string, ServerSpec | HttpSpec> | undefined;

  const clientFor = async (name: string): Promise<Client> => {
    const existing = clients.get(name);
    if (existing) return existing;
    specs ??= readMcpConfig(root);
    const spec = specs[name];
    if (spec === undefined) throw new Error(`unknown server ${name}`);
    if ('http' in spec) {
      if (spec.error !== undefined) throw new Error(spec.error);
      const transport = new StreamableHTTPClientTransport(new URL(spec.url), {
        requestInit: { headers: spec.headers },
        fetch: proxyFetch(),
      });
      const client = new Client({ name: 'geldar-stub', version: '0.1.0' });
      await client.connect(transport);
      clients.set(name, client);
      return client;
    }
    const resolved = options.resolveCommand
      ? options.resolveCommand({ command: spec.command, args: spec.args })
      : { command: spec.command, args: spec.args };
    const transport = new StdioClientTransport({
      command: resolved.command,
      args: resolved.args,
      env: { ...stringEntries(process.env), ...spec.env, ...options.env },
      cwd: root,
    });
    const client = new Client({ name: 'geldar-stub', version: '0.1.0' });
    await client.connect(transport);
    clients.set(name, client);
    return client;
  };

  // Resolves a step path inside the player folder, or throws.
  const insideRoot = (relative: string): string => {
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) {
      throw new Error(`path escapes the player folder: ${relative}`);
    }
    return target;
  };

  try {
    for (const [i, step] of options.steps.entries()) {
      const index = i + 1;
      if (step.op === 'call') {
        const client = await clientFor(step.server);
        const result = await client.callTool({ name: step.tool, arguments: step.args });
        const content = result.content as { type: string; text?: string }[];
        const text = content
          .filter((part) => part.type === 'text')
          .map((part) => part.text ?? '')
          .join('\n');
        const isError = Boolean(result.isError);
        const problems: string[] = [];
        if (isError !== step.expect.error) {
          problems.push(`error was ${isError}, expected ${step.expect.error}`);
        }
        for (const want of step.expect.includes) {
          if (!text.includes(want)) problems.push(`missing "${want}"`);
        }
        for (const banned of step.expect.excludes) {
          if (text.includes(banned)) problems.push(`found "${banned}"`);
        }
        if (problems.length === 0) {
          results.push({ index, op: step.op, ok: true, text });
        } else {
          const failure = `${problems.join('; ')}; output: ${text.slice(0, 200)}`;
          results.push({ index, op: step.op, ok: false, text, failure });
          break; // later steps are not run
        }
      } else if (step.op === 'write') {
        const target = insideRoot(step.path);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, step.content);
        results.push({ index, op: step.op, ok: true });
      } else if (step.op === 'append') {
        const target = insideRoot(step.path);
        mkdirSync(path.dirname(target), { recursive: true });
        appendFileSync(target, step.content);
        results.push({ index, op: step.op, ok: true });
      } else {
        rmSync(insideRoot(step.path), { force: true });
        results.push({ index, op: step.op, ok: true });
      }
    }
  } finally {
    await Promise.allSettled([...clients.values()].map((client) => client.close()));
  }
  return results;
}
