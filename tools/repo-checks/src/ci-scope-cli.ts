/**
 * `node ci-scope-cli.ts [file]` reads changed paths, one per line, from `file` or stdin and prints
 * `static=`, `hostile=`, `launcher=`, `image=`, `rest=`, `e2e=` and `markdown=` lines for
 * `>> "$GITHUB_OUTPUT"`. Any read error prints every job on (fail open) and exits 0.
 */
import { readFileSync } from 'node:fs';
import { ALL, outputLines, parsePaths, scopeFor } from './ci-scope.ts';

const [file] = process.argv.slice(2);

let scope = ALL;
try {
  const text = readFileSync(file ?? 0, 'utf8');
  scope = scopeFor(parsePaths(text));
} catch (error) {
  console.error(`ci-scope: running every job (${(error as Error).message})`);
}

for (const line of outputLines(scope)) console.log(line);
