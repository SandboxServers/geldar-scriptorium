import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { makeRepo } from './repo-fixture.ts';
import { createServer } from './server.ts';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function connect(root: string) {
  const server = createServer(root, 'play');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

function textOf(result: unknown): string {
  return (result as { content: { type: string; text?: string }[] }).content
    .map((c) => c.text ?? '')
    .join('');
}

describe('createServer', () => {
  it('offers exactly one tool, commit_memory', async () => {
    const repo = makeRepo({ 'CLAUDE.md': 'rules\n', 'memory/summary.md': 'one\n' });
    cleanups.push(repo.cleanup);
    const client = await connect(repo.root);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(['commit_memory']);
    await client.close();
  });

  it('saves an edited memory file and reports it, then refuses a repeat as an error', async () => {
    const repo = makeRepo({ 'CLAUDE.md': 'rules\n', 'memory/summary.md': 'one\n' });
    cleanups.push(repo.cleanup);
    writeFileSync(join(repo.root, 'memory/summary.md'), 'two\n');
    const client = await connect(repo.root);

    const first = await client.callTool({
      name: 'commit_memory',
      arguments: { message: 'day one' },
    });
    expect(first.isError).not.toBe(true);
    const saved = JSON.parse(textOf(first)) as {
      saved: string;
      files: string[];
      not_saved: string[];
    };
    expect(saved.saved).toHaveLength(7);
    expect(saved.files).toEqual(['memory/summary.md']);
    expect(saved.not_saved).toEqual([]);

    const second = await client.callTool({
      name: 'commit_memory',
      arguments: { message: 'again' },
    });
    expect(second.isError).toBe(true);
    expect(JSON.parse(textOf(second))).toMatchObject({ error: 'nothing_to_commit' });
    await client.close();
  });
});
