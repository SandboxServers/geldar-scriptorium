import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkTemplate, repoRoot } from './check.ts';

const schemaPath = path.join(repoRoot, 'schemas/player.schema.json');
let scratch: string;
let copy: string;

// A throwaway copy of the real template/ folder, so each test can break one thing.
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'sc-10-template-'));
  copy = path.join(scratch, 'template');
  cpSync(path.join(repoRoot, 'template'), copy, { recursive: true });
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('template boundary check', () => {
  it('passes on the real template', () => {
    expect(checkTemplate(path.join(repoRoot, 'template'), schemaPath)).toEqual([]);
  });

  it('reports an extra file that is not on the list', () => {
    writeFileSync(path.join(copy, 'notes.md'), 'Stray file.\n');
    const problems = checkTemplate(copy, schemaPath);
    expect(problems.some((p) => p.includes('notes.md'))).toBe(true);
  });

  it('reports a missing memory/summary.md', () => {
    unlinkSync(path.join(copy, 'memory', 'summary.md'));
    const problems = checkTemplate(copy, schemaPath);
    expect(problems.some((p) => p.includes('memory/summary.md'))).toBe(true);
  });

  it('reports a stale CLAUDE.md through the template check', () => {
    const claude = path.join(copy, 'CLAUDE.md');
    writeFileSync(claude, readFileSync(claude, 'utf8').replace('Do little.', 'Do much.'));
    const problems = checkTemplate(copy, schemaPath);
    expect(problems).toContain(
      'CLAUDE.md is out of date; run `node tests/template/instructions.ts --write`',
    );
  });

  it('reports player.json with harness gemini', () => {
    writeFileSync(
      path.join(copy, 'player.json'),
      '{\n  "player_id": "",\n  "name": "",\n  "shard": "",\n  "mcp_url": "",\n  "harness": "gemini",\n  "declared_model": "haiku",\n  "kit_version": "",\n  "kit_image": ""\n}\n',
    );
    const problems = checkTemplate(copy, schemaPath);
    expect(problems.some((p) => p.includes('player.json') && p.includes('/harness'))).toBe(true);
  });
});
