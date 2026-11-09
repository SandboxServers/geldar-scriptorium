#!/usr/bin/env node
import { parseVerifyArgs } from './args.ts';
import { verify } from './verify.ts';

// Exit 0 for ok, 1 for a rejection, 2 for bad arguments. Stdout holds only the verdict line.
const input = parseVerifyArgs(process.argv.slice(2));
if (input === null) {
  process.stdout.write('{"ok":false,"reasons":["bad_arguments"]}\n');
  process.exitCode = 2;
} else {
  const result = verify(input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
