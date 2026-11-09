#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { runScenario } from './run.ts';
import { parseScenario } from './scenario.ts';

// Only the scenario is used. Every other argument (such as --settings) is ignored.
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { scenario: { type: 'string' } },
  strict: false,
  allowPositionals: true,
});

const scenarioFile = values.scenario ?? process.env.GELDAR_STUB_SCENARIO;

// exitCode, not process.exit: a process.exit can cut off piped stdout on Windows.
if (typeof scenarioFile !== 'string' || scenarioFile === '') {
  process.stderr.write(
    'claude (stub): no scenario; pass --scenario <file> or set GELDAR_STUB_SCENARIO\n',
  );
  process.exitCode = 2;
} else {
  try {
    const steps = parseScenario(readFileSync(scenarioFile, 'utf8'));
    const results = await runScenario({ root: process.cwd(), steps });
    for (const result of results) {
      const line = result.ok
        ? `step ${result.index} ${result.op} ok`
        : `step ${result.index} ${result.op} FAIL: ${result.failure ?? ''}`;
      process.stdout.write(`${line}\n`);
    }
    const allPassed = results.length === steps.length && results.every((r) => r.ok);
    process.exitCode = allPassed ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`claude (stub): ${message}\n`);
    process.exitCode = 1;
  }
}
