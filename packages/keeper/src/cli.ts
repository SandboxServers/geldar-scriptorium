#!/usr/bin/env node
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from './config.ts';
import { runGit } from './git.ts';
import { runOnce } from './keeper.ts';
import { runLoop } from './loop.ts';
import { sshTransport } from './transport.ts';

// geldar-keeper [--once]: the loop of the keeper service. Configuration is environment only.
// Exit 2 for bad configuration. SIGTERM and SIGINT end it after the current step.
let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env, mkdtempSync(join(tmpdir(), 'keeper-hooks-')));
} catch (error) {
  process.stderr.write(
    `geldar-keeper: ${error instanceof Error ? error.message : 'bad configuration'}\n`,
  );
  process.exit(2);
}

const deps = {
  git: runGit,
  transport: sshTransport(config),
  log: (line: string) => process.stdout.write(`${line}\n`),
  now: () => new Date(),
};

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    stopping = true;
  });

if (process.argv.includes('--once')) {
  const result = await runOnce(config, deps);
  process.exitCode = result.outcome === 'held' ? 1 : 0;
} else {
  await runLoop(config, deps, { now: () => Date.now(), sleep: (ms) => delay(ms) }, () => stopping);
}
