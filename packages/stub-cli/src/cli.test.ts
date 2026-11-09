import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));
const memoryCli = fileURLToPath(new URL('../../memory/src/cli.ts', import.meta.url));
const templateMemory = fileURLToPath(new URL('../../../template/memory', import.meta.url));
const TIMEOUT = 30_000;

let root: string;

function scenarioLine(includes: string): string {
  const step = {
    op: 'call',
    server: 'geldar_memory',
    tool: 'recall',
    args: { section: 'summary' },
    expect: { error: false, includes: [includes], excludes: [] },
  };
  return JSON.stringify(step);
}

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): ReturnType<typeof spawnSync> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  delete childEnv.GELDAR_STUB_SCENARIO;
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    env: childEnv,
    encoding: 'utf8',
  });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'stub-cli-'));
  cpSync(templateMemory, path.join(root, 'memory'), { recursive: true });
  writeFileSync(
    path.join(root, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        geldar_memory: { command: process.execPath, args: [memoryCli, '--root', root] },
      },
    }),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('stub CLI', () => {
  it(
    'exits 0 and prints each passing step',
    () => {
      const scenario = path.join(root, 'pass.jsonl');
      writeFileSync(scenario, `${scenarioLine('Recent days')}\n`);
      const result = runCli(['--settings', '/x/y.json', '--scenario', scenario]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('step 1 call ok');
    },
    TIMEOUT,
  );

  it(
    'exits 1 and prints the failure for a failing expectation',
    () => {
      const scenario = path.join(root, 'fail.jsonl');
      writeFileSync(scenario, `${scenarioLine('NOT-IN-THE-SUMMARY')}\n`);
      const result = runCli(['--scenario', scenario]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('step 1 call FAIL:');
    },
    TIMEOUT,
  );

  it('exits 2 when there is no scenario', () => {
    const result = runCli([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('no scenario');
  });
});
