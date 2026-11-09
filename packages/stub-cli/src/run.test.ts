import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runScenario } from './run.ts';
import type { Step } from './scenario.ts';

const memoryCli = fileURLToPath(new URL('../../memory/src/cli.ts', import.meta.url));
const templateRoot = fileURLToPath(new URL('../../../template/', import.meta.url));
const TIMEOUT = 30_000;

let root: string;

// The memory server's root and the stub's root are the same folder.
function copyTemplateMemory(): void {
  cpSync(path.join(templateRoot, 'memory'), path.join(root, 'memory'), { recursive: true });
}

function writeMcpConfig(servers: Record<string, unknown>): void {
  writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: servers }));
}

function recallStep(
  section: string,
  expect: Partial<{ error: boolean; includes: string[] }> = {},
): Step {
  return {
    op: 'call',
    server: 'geldar_memory',
    tool: 'recall',
    args: { section },
    expect: { error: expect.error ?? false, includes: expect.includes ?? [], excludes: [] },
  };
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'stub-run-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('runScenario', () => {
  it(
    'writes a summary and recalls it through the memory server',
    async () => {
      copyTemplateMemory();
      writeMcpConfig({
        geldar_memory: { command: process.execPath, args: [memoryCli, '--root', root] },
      });
      const results = await runScenario({
        root,
        steps: [
          { op: 'write', path: 'memory/summary.md', content: 'Winter came early to Vell.\n' },
          recallStep('summary', { includes: ['Winter came early to Vell.'] }),
        ],
      });
      expect(results.map((r) => r.ok)).toEqual([true, true]);
    },
    TIMEOUT,
  );

  it(
    'stops at the first failed expectation and runs no later step',
    async () => {
      copyTemplateMemory();
      writeMcpConfig({
        geldar_memory: { command: process.execPath, args: [memoryCli, '--root', root] },
      });
      const missing = recallStep('journal/day-009', { error: true, includes: ['not_found'] });
      const wrongError = recallStep('journal/day-009');
      const after: Step = { op: 'write', path: 'memory/after.md', content: 'x' };

      const ok = await runScenario({ root, steps: [missing, after] });
      expect(ok.map((r) => r.ok)).toEqual([true, true]);

      rmSync(path.join(root, 'memory/after.md'));
      const failed = await runScenario({ root, steps: [wrongError, after] });
      expect(failed).toHaveLength(1);
      expect(failed[0]?.ok).toBe(false);
      expect(failed[0]?.failure).toContain('not_found');
      expect(existsSync(path.join(root, 'memory/after.md'))).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'runs the template .mcp.json entry once resolveCommand maps it to node',
    async () => {
      copyTemplateMemory();
      cpSync(path.join(templateRoot, '.mcp.json'), path.join(root, '.mcp.json'));
      const results = await runScenario({
        root,
        steps: [recallStep('summary', { includes: ['Recent days'] })],
        resolveCommand: ({ command, args }) =>
          command === 'geldar-memory'
            ? {
                command: process.execPath,
                args: [memoryCli, ...args.map((a) => (a === '/player' ? root : a))],
              }
            : { command, args },
      });
      expect(results.map((r) => r.ok)).toEqual([true]);
    },
    TIMEOUT,
  );

  it(
    'a call to an http server with an unset variable is an error naming it',
    async () => {
      cpSync(path.join(templateRoot, '.mcp.json'), path.join(root, '.mcp.json'));
      const step: Step = {
        op: 'call',
        server: 'geldar',
        tool: 'recall',
        args: {},
        expect: { error: false, includes: [], excludes: [] },
      };
      const saved = { url: process.env.GELDAR_MCP_URL, token: process.env.GELDAR_MCP_TOKEN };
      delete process.env.GELDAR_MCP_URL;
      delete process.env.GELDAR_MCP_TOKEN;
      try {
        await expect(runScenario({ root, steps: [step] })).rejects.toThrow('GELDAR_MCP_TOKEN');
      } finally {
        if (saved.url !== undefined) process.env.GELDAR_MCP_URL = saved.url;
        if (saved.token !== undefined) process.env.GELDAR_MCP_TOKEN = saved.token;
      }
    },
    TIMEOUT,
  );

  it('writes, appends and deletes without enforcing anything, and refuses paths outside the folder', async () => {
    const steps: Step[] = [
      { op: 'write', path: 'CLAUDE.md', content: 'x' },
      { op: 'append', path: 'CLAUDE.md', content: 'y' },
    ];
    const results = await runScenario({ root, steps });
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(readFileSync(path.join(root, 'CLAUDE.md'), 'utf8')).toBe('xy');

    await runScenario({ root, steps: [{ op: 'delete', path: 'CLAUDE.md' }] });
    expect(existsSync(path.join(root, 'CLAUDE.md'))).toBe(false);

    const outside = path.join(root, '..', 'outside.md');
    rmSync(outside, { force: true });
    await expect(
      runScenario({ root, steps: [{ op: 'write', path: '../outside.md', content: 'x' }] }),
    ).rejects.toThrow('path escapes the player folder');
    expect(existsSync(path.join(root, '..', 'outside.md'))).toBe(false);
  });
});
