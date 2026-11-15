// geldar-instinct: `run --run <n>` prints one result line and exits 0; `check-sheet <path>` prints nothing and exits
// 0 for a valid sheet or 2 for an invalid one. Any other use exits 2. A failure outside run exits 1.
import { readFileSync } from 'node:fs';
import { parseSheet } from '@geldar/scriptorium-psyche';
import { runInstinct } from './run.ts';

async function main(argv: string[]): Promise<number> {
  const [verb, ...rest] = argv;
  if (verb === 'run' && rest.length === 2 && rest[0] === '--run') {
    // No state directory means no store to read or write: refuse rather than use an empty path.
    if (!process.env.GELDAR_INSTINCT_STATE) return 2;
    const runNo = Number(rest[1]);
    if (!Number.isSafeInteger(runNo) || runNo < 0) return 2;
    const result = await runInstinct(process.env, runNo);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }
  if (verb === 'check-sheet' && rest.length === 1) {
    try {
      return parseSheet(readFileSync(rest[0] as string, 'utf8')) === null ? 2 : 0;
    } catch {
      return 2;
    }
  }
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.exitCode = 1;
  },
);
