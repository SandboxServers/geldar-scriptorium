import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkTemplate, forbidden, repoRoot, tokenShapes } from './check.ts';

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

const shaped = (s: string): boolean => tokenShapes.some((r) => r.test(s));

describe('tokenShapes', () => {
  it.each([
    'GELDAR_MCP_TOKEN=abcdef123456',
    'Bearer abc12345',
    'bearer abc12345',
    'Bearer eyJ.eyJzdWIiOiJ4In0.sig12345',
    'authorization: Bearer abcdefghijklmnopqrstuvwxyz',
  ])('flags %s', (s) => {
    expect(shaped(s)).toBe(true);
  });

  it.each([
    '`GELDAR_MCP_TOKEN=<value>`',
    'GELDAR_MCP_TOKEN=<value>,',
    '(GELDAR_MCP_TOKEN=<value>)',
    'GELDAR_MCP_TOKEN=<your-token-here>',
    'GELDAR_MCP_TOKEN=$OTHER_VAR',
    'GELDAR_MCP_TOKEN=${GELDAR_MCP_TOKEN}',
    'Bearer ${GELDAR_MCP_TOKEN}',
    'Bearer <token>',
    'Plain prose about a bear and a token.',
  ])('does not flag %s', (s) => {
    expect(shaped(s)).toBe(false);
  });
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
    writeFileSync(claude, readFileSync(claude, 'utf8').replace('Decide once,', 'Decide twice,'));
    const problems = checkTemplate(copy, schemaPath);
    expect(problems).toContain(
      'CLAUDE.md is out of date; run `node tests/template/instructions.ts --write`',
    );
  });

  it('flags the old developer header through forbidden', () => {
    const claude = path.join(copy, 'CLAUDE.md');
    const header = '<!-- Generated from template-src/instructions.md. Do not edit. -->';
    writeFileSync(claude, `${header}\n${readFileSync(claude, 'utf8')}`);
    const problems = checkTemplate(copy, schemaPath);
    expect(problems).toContain('template/CLAUDE.md contains forbidden text "template-src"');
    expect(problems).toContain('template/CLAUDE.md contains forbidden text "Do not edit"');
    expect(forbidden).toEqual(expect.arrayContaining(['template-src', 'Do not edit']));
  });

  it('reports a token-shaped string in a template file', () => {
    const claude = path.join(copy, 'CLAUDE.md');
    writeFileSync(claude, `${readFileSync(claude, 'utf8')}\nGELDAR_MCP_TOKEN=abcdef123456\n`);
    const problems = checkTemplate(copy, schemaPath);
    expect(problems).toContain('template/CLAUDE.md contains a token-shaped string');
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
