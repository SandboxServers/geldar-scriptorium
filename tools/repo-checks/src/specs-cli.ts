/** `pnpm check:specs`: lint docs/analysis/scriptorium/*.md. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSpecs } from './specs.ts';

const dir = 'docs/analysis/scriptorium';
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => ({ file: `${dir}/${f}`, text: readFileSync(join(dir, f), 'utf8') }));
const findings = checkSpecs(files, readFileSync(join(dir, 'README.md'), 'utf8'));
for (const f of findings) console.log(`error: ${f.file}:${f.line}: ${f.message}`);
console.log(findings.length > 0 ? 'spec checks: failed' : 'spec checks: ok');
process.exitCode = findings.length > 0 ? 1 : 0;
