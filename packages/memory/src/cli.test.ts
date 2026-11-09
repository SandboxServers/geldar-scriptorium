import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { textOf } from './test-client.ts';

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'cli.ts');
let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'sc21-cli-'));
  mkdirSync(path.join(root, 'memory'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('geldar-memory command line', () => {
  it('exits 2 and names --root when it is missing', () => {
    const run = spawnSync(process.execPath, [cliPath], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('--root');
  });

  it('serves recall over real stdio', { timeout: 30000 }, async () => {
    writeFileSync(path.join(root, 'memory', 'summary.md'), 'stdio summary');
    const env = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliPath, '--root', root],
      env,
    });
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(transport);
    try {
      const result = await client.callTool({ name: 'recall', arguments: { section: 'summary' } });
      expect(JSON.parse(textOf(result)).text).toBe('stdio summary');
    } finally {
      await client.close();
    }
  });
});
