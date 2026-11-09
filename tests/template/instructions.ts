import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Harness = 'claude' | 'codex';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../..');
export const sourcePath = path.join(repoRoot, 'template-src/instructions.md');

// The instruction files the template ships, and the harness each one is rendered for.
const outputs: readonly { file: string; harness: Harness }[] = [
  { file: 'CLAUDE.md', harness: 'claude' },
  { file: 'AGENTS.md', harness: 'codex' },
];

const header = '<!-- Generated from template-src/instructions.md. Do not edit. -->';

// The same body for every harness, under one generated-file comment. The harness
// argument is kept so a future harness-specific line has one place to go.
export function render(_harness: Harness, body: string = readFileSync(sourcePath, 'utf8')): string {
  return `${header}\n${body.endsWith('\n') ? body : `${body}\n`}`;
}

// Returns one message per out-of-date file; an empty array means the files match.
// A missing file is left to the template checker, which reports it.
export function checkInstructions(
  templateDir: string,
  body: string = readFileSync(sourcePath, 'utf8'),
): string[] {
  const problems: string[] = [];
  for (const { file, harness } of outputs) {
    const target = path.join(templateDir, file);
    if (!existsSync(target)) continue;
    if (readFileSync(target, 'utf8') !== render(harness, body)) {
      problems.push(`${file} is out of date; run \`node tests/template/instructions.ts --write\``);
    }
  }
  return problems;
}

export function writeInstructions(templateDir: string): void {
  const body = readFileSync(sourcePath, 'utf8');
  for (const { file, harness } of outputs) {
    writeFileSync(path.join(templateDir, file), render(harness, body));
  }
}

// CLI: node tests/template/instructions.ts --write | --check
if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const templateDir = path.join(repoRoot, 'template');
  const mode = process.argv[2];
  if (mode === '--write') {
    writeInstructions(templateDir);
    console.log('instructions: wrote template/CLAUDE.md and template/AGENTS.md');
  } else if (mode === '--check') {
    const problems = checkInstructions(templateDir);
    for (const p of problems) console.log(p);
    if (problems.length > 0) process.exitCode = 1;
    else console.log('instructions: ok');
  } else {
    console.log('usage: node tests/template/instructions.ts --write | --check');
    process.exitCode = 2;
  }
}
