import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import { allowedFiles, pendingFiles } from './allowed-files.ts';
import { checkInstructions } from './instructions.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../..');

// Case-sensitive words that must not appear in any file under template/.
export const forbidden = [
  'scriptorium',
  'packet',
  'SC-',
  'CI',
  'pnpm',
  'geldar.ps1',
  'template-src',
  'Do not edit',
];

// Every file under dir, as forward-slash paths relative to dir.
function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(dir, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

// Returns one message per problem; an empty array means the template passes.
// templateDir is the template/ folder, schemaPath the player.json schema.
export function checkTemplate(
  templateDir: string,
  schemaPath: string,
  allowed: readonly string[] = allowedFiles,
  pending: readonly string[] = pendingFiles,
): string[] {
  const problems: string[] = [];
  const rels = listFiles(templateDir);
  const have = new Set(rels.map((f) => `template/${f}`));

  for (const f of have) {
    if (!allowed.includes(f)) problems.push(`extra file not on the published list: ${f}`);
  }
  for (const f of allowed) {
    if (!have.has(f) && !pending.includes(f)) problems.push(`missing file: ${f}`);
  }
  for (const rel of rels) {
    const text = readFileSync(path.join(templateDir, rel), 'utf8');
    for (const word of forbidden) {
      if (text.includes(word)) problems.push(`template/${rel} contains forbidden text "${word}"`);
    }
  }

  problems.push(...checkInstructions(templateDir));

  if (have.has('template/player.json')) {
    problems.push(...checkPlayer(path.join(templateDir, 'player.json'), schemaPath));
  }
  return problems;
}

function checkPlayer(playerPath: string, schemaPath: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(playerPath, 'utf8'));
  } catch {
    return ['template/player.json is not valid JSON'];
  }
  const schema: unknown = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const validate = new Ajv2020({ allErrors: true }).compile(schema as object);
  if (validate(data)) return [];
  return (validate.errors ?? []).map(
    (e: ErrorObject) =>
      `template/player.json ${e.instancePath || '/'} ${e.message ?? 'is invalid'}`,
  );
}

// CLI: node tests/template/check.ts
if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const problems = checkTemplate(
    path.join(repoRoot, 'template'),
    path.join(repoRoot, 'schemas/player.schema.json'),
  );
  for (const p of problems) console.log(p);
  if (problems.length > 0) process.exitCode = 1;
  else console.log('template: ok');
}
