import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));

/** Runs the CLI with only PATH (and SystemRoot on Windows) in its environment, plus the given names. */
function cli(args: string[], env: Record<string, string> = {}) {
  const base: Record<string, string> = { PATH: process.env.PATH ?? '' };
  if (process.env.SystemRoot) base.SystemRoot = process.env.SystemRoot;
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...base, ...env },
    timeout: 60_000,
  });
}

const VALID_SHEET = JSON.stringify({
  version: 1,
  attributes: { curiosity: 3, common_sense: 3, cleverness: 3, aggression: 3 },
  alignment: { law: 3, good: 3 },
  op_modes: { explorer: 3, farmer: 3, miner: 3, builder: 3, crafter: 3, warrior: 3, nitwit: 3 },
});

describe('geldar-instinct CLI', () => {
  it('run refuses with exit 2 when GELDAR_INSTINCT_STATE is unset', () => {
    const out = cli(['run', '--run', '1']);
    expect(out.status).toBe(2);
    expect(out.stdout).toBe('');
  });

  it('an unknown verb exits 2', () => {
    expect(cli(['bogus']).status).toBe(2);
  });

  it('check-sheet exits 0 for a valid sheet and prints nothing', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'instinct-cli-')), 'sheet.json');
    writeFileSync(file, VALID_SHEET);
    const out = cli(['check-sheet', file]);
    expect(out.status).toBe(0);
    expect(out.stdout).toBe('');
  });

  it('check-sheet exits 2 for an invalid sheet and for a missing file, printing nothing', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'instinct-cli-')), 'sheet.json');
    writeFileSync(file, '{"version":1,"secret_field":9}');
    for (const target of [file, join(tmpdir(), 'no-such-instinct-sheet.json')]) {
      const out = cli(['check-sheet', target]);
      expect(out.status).toBe(2);
      expect(out.stdout).toBe('');
    }
  });
});
