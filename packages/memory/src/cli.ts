#!/usr/bin/env node
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.ts';

function fail(message: string): never {
  process.stderr.write(`geldar-memory: ${message}\n`);
  process.exit(2);
}

let rootArg: string | undefined;
try {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { root: { type: 'string' } },
    strict: true,
  });
  rootArg = values.root;
} catch (error) {
  fail(error instanceof Error ? error.message : 'bad arguments');
}

if (rootArg === undefined) fail('--root <dir> is required');

let root: string;
try {
  root = realpathSync(path.resolve(rootArg));
  if (!statSync(root).isDirectory()) fail(`--root ${rootArg} is not a folder`);
} catch {
  fail(`--root ${rootArg} does not exist`);
}

const server = createServer(root);
await server.connect(new StdioServerTransport());
