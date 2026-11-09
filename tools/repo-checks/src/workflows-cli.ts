/** `pnpm check:workflows [dir]`: lint .github/workflows/*.yml and *.yaml. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkWorkflow } from './workflows.ts';

const dir = process.argv[2] ?? '.github/workflows';
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => ({ path: `${dir}/${f}`, text: readFileSync(join(dir, f), 'utf8') }));
const findings = files.flatMap(checkWorkflow);
for (const f of findings)
  console.log(`error: ${f.file}${f.line ? `:${f.line}` : ''}: [${f.rule}] ${f.message}`);
console.log(findings.length > 0 ? 'workflow checks: failed' : 'workflow checks: ok');
process.exitCode = findings.length > 0 ? 1 : 0;
