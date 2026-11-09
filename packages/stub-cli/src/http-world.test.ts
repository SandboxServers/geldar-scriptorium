import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { run as docker, dockerReady, repoRoot } from '../../../tests/image/docker.ts';
import { runScenario } from './run.ts';
import type { Step } from './scenario.ts';
import { startWorld, type World } from './test-world.ts';

const TIMEOUT = 60_000;
const callStatus: Step = {
  op: 'call',
  server: 'world',
  tool: 'status',
  args: {},
  expect: { error: false, includes: ['"day"'], excludes: [] },
};

let root: string;
let world: World;
let token: string;
const saved: Record<string, string | undefined> = {};

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function writeConfig(): void {
  const config = {
    mcpServers: {
      world: {
        type: 'http',
        url: '${GELDAR_MCP_URL}',
        headers: { Authorization: 'Bearer ${GELDAR_MCP_TOKEN}' },
      },
    },
  };
  writeFileSync(path.join(root, '.mcp.json'), JSON.stringify(config));
}

beforeEach(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'stub-http-'));
  token = randomBytes(24).toString('base64url');
  world = await startWorld({ port: 0, token });
  writeConfig();
  setEnv({
    GELDAR_MCP_URL: `http://127.0.0.1:${world.port}/p/test`,
    GELDAR_MCP_TOKEN: token,
    HTTP_PROXY: undefined,
    http_proxy: undefined,
  });
});

afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await world.close();
  rmSync(root, { recursive: true, force: true });
});

describe('stub over http', () => {
  it(
    'calls the world and the bearer header arrives',
    async () => {
      const results = await runScenario({ root, steps: [callStatus] });
      expect(results.map((r) => r.ok)).toEqual([true]);
      expect(results[0]?.text).toContain('"day":1');
      expect(world.seen.some((h) => h.authorization === `Bearer ${token}`)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'goes through HTTP_PROXY with the absolute url, and not without one',
    async () => {
      const lines: string[] = [];
      const proxy = http.createServer((req, res) => {
        lines.push(`${req.method} ${req.url}`);
        const upstream = new URL(req.url ?? '');
        const out = http.request(
          {
            host: upstream.hostname,
            port: upstream.port,
            method: req.method,
            path: upstream.pathname + upstream.search,
            headers: req.headers,
          },
          (back) => {
            res.writeHead(back.statusCode ?? 502, back.headers);
            back.pipe(res);
          },
        );
        req.pipe(out);
      });
      await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
      try {
        await runScenario({ root, steps: [callStatus] });
        expect(lines).toEqual([]);

        const addr = proxy.address() as { port: number };
        setEnv({ HTTP_PROXY: `http://127.0.0.1:${addr.port}` });
        const results = await runScenario({ root, steps: [callStatus] });
        expect(results.map((r) => r.ok)).toEqual([true]);
        expect(lines.length).toBeGreaterThan(0);
        expect(lines[0]).toBe(`POST http://127.0.0.1:${world.port}/p/test`);
      } finally {
        proxy.closeAllConnections();
        await new Promise((resolve) => proxy.close(resolve));
      }
    },
    TIMEOUT,
  );

  it(
    'an unset variable is an error naming it, and nothing is sent',
    async () => {
      setEnv({ GELDAR_MCP_TOKEN: undefined });
      await expect(runScenario({ root, steps: [callStatus] })).rejects.toThrow('GELDAR_MCP_TOKEN');
      expect(world.seen).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'refuses https urls',
    async () => {
      setEnv({ GELDAR_MCP_URL: 'https://127.0.0.1:1/p/test' });
      await expect(runScenario({ root, steps: [callStatus] })).rejects.toThrow(/https/);
      expect(world.seen).toEqual([]);
    },
    TIMEOUT,
  );
});

const ready = dockerReady();
const KIT = process.env.KIT_IMAGE ?? 'geldar-kit:test';
const STUB = 'geldar-kit-stub:sc55a';

describe.skipIf(!ready)('stub image variant', () => {
  beforeAll(() => {
    const kit = spawnSync(
      'docker',
      ['build', '--target', 'kit', '-f', 'image/Dockerfile', '-t', KIT, '.'],
      { cwd: repoRoot, encoding: 'utf8', timeout: 900_000 },
    );
    if (kit.status !== 0) throw new Error(`kit build failed: ${kit.stderr}`);
    const stub = spawnSync(
      'docker',
      ['build', '-f', 'image/stub.Dockerfile', '--build-arg', `KIT_BASE=${KIT}`, '-t', STUB, '.'],
      { cwd: repoRoot, encoding: 'utf8', timeout: 900_000 },
    );
    if (stub.status !== 0) throw new Error(`stub build failed: ${stub.stderr}`);
  }, 900_000);

  it(
    'claude is the stub and stub-cli is installed',
    () => {
      const out = docker(['run', '--rm', STUB, 'claude', '--version']);
      expect(out.status).toBe(2);
      expect(out.stderr).toContain('claude (stub)');
      const ls = docker(['run', '--rm', STUB, 'ls', '/opt/geldar-stub/packages']);
      expect(ls.stdout).toContain('stub-cli');
    },
    TIMEOUT,
  );

  it(
    'the kit image still has no stub-cli',
    () => {
      const ls = docker(['run', '--rm', KIT, 'ls', '/opt/geldar/packages']);
      expect(ls.status).toBe(0);
      expect(ls.stdout).not.toContain('stub-cli');
    },
    TIMEOUT,
  );
});
