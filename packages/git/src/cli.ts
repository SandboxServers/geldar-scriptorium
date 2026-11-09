#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Mode } from '@geldar/scriptorium-path-rule';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CommitRefusal, commitMemory, parseMode } from './commit.ts';
import { createServer } from './server.ts';

const USAGE = [
  'usage: geldar-git mcp --root <dir> [--mode play|setup]',
  '       geldar-git commit --root <dir> --message <m> [--if-changed] [--mode play|setup]',
].join('\n');

function usageError(): number {
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

function fail(code: string, message: string): number {
  process.stderr.write(`geldar-git: ${code}: ${message}\n`);
  return 1;
}

async function runMcp(args: string[]): Promise<number> {
  let values: { root?: string; mode?: string };
  try {
    ({ values } = parseArgs({
      args,
      options: { root: { type: 'string' }, mode: { type: 'string' } },
      strict: true,
    }));
  } catch {
    return usageError();
  }
  if (values.root === undefined) return usageError();
  let mode: Mode;
  try {
    mode = parseMode(values.mode ?? process.env.GELDAR_MODE);
  } catch (err) {
    return refusalExit(err);
  }
  const server = createServer(resolve(values.root), mode);
  await server.connect(new StdioServerTransport());
  return 0;
}

function refusalExit(err: unknown): number {
  if (err instanceof CommitRefusal) return fail(err.code, err.message);
  return fail('git_failed', 'The save did not work.');
}

function runCommit(args: string[]): number {
  let values: { root?: string; message?: string; 'if-changed'?: boolean; mode?: string };
  try {
    ({ values } = parseArgs({
      args,
      options: {
        root: { type: 'string' },
        message: { type: 'string' },
        'if-changed': { type: 'boolean' },
        mode: { type: 'string' },
      },
      strict: true,
    }));
  } catch {
    return usageError();
  }
  if (values.root === undefined || values.message === undefined) return usageError();
  const ifChanged = values['if-changed'] === true;
  try {
    const mode = parseMode(values.mode ?? process.env.GELDAR_MODE);
    const result = commitMemory({ root: resolve(values.root), message: values.message, mode });
    process.stdout.write(`saved ${result.sha.slice(0, 7)}: ${result.files.length} file(s)\n`);
    return 0;
  } catch (err) {
    if (ifChanged && err instanceof CommitRefusal && err.code === 'nothing_to_commit') return 0;
    return refusalExit(err);
  }
}

async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === 'mcp') return runMcp(rest);
  if (sub === 'commit') return runCommit(rest);
  return usageError();
}

const code = await main(process.argv.slice(2));
if (code !== 0) process.exitCode = code;
