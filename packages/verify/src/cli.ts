#!/usr/bin/env node
import { parseVerifyArgs } from './args.ts';
import { summarizeStream } from './run-summary.ts';
import { verify } from './verify.ts';

// Exit 0 for ok, 1 for a rejection, 2 for bad arguments. Stdout holds only the verdict line.
// `run-summary` reads a headless stream-json transcript on stdin and prints one summary line;
// it exits 0 always, except 2 for any option (it takes none).
const argv = process.argv.slice(2);
if (argv[0] === 'run-summary') {
  if (argv.length > 1) {
    process.stderr.write('run-summary takes no options\n');
    process.exitCode = 2;
  } else {
    process.stdin.setEncoding('utf8');
    const summary = await summarizeStream(process.stdin);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  }
} else {
  const input = parseVerifyArgs(argv);
  if (input === null) {
    process.stdout.write('{"ok":false,"reasons":["bad_arguments"]}\n');
    process.exitCode = 2;
  } else {
    const result = verify(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  }
}
