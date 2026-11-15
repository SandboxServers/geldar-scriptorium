import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lifeKeyOf, runInstinct } from './run.ts';

/** The standard sheet: every score 3 (the kit's own reader accepts it; the world copy is canonical). */
const STANDARD_SHEET = JSON.stringify({
  version: 1,
  attributes: { curiosity: 3, common_sense: 3, cleverness: 3, aggression: 3 },
  alignment: { law: 3, good: 3 },
  op_modes: { explorer: 3, farmer: 3, miner: 3, builder: 3, crafter: 3, warrior: 3, nitwit: 3 },
});

/** A fresh instinct directory under a volume root, as the supervisor lays it out. */
function volume(): { stateDir: string; audit: string } {
  const root = mkdtempSync(join(tmpdir(), 'instinct-run-'));
  const stateDir = join(root, 'instinct');
  mkdirSync(stateDir, { recursive: true });
  return { stateDir, audit: join(root, 'instinct.jsonl') };
}

describe('runInstinct early outcomes (no world, no fixture)', () => {
  it('a missing sheet gives pass no_sheet and one audit line with source instinct', async () => {
    const { stateDir, audit } = volume();
    const result = await runInstinct({ GELDAR_INSTINCT_STATE: stateDir }, 4);
    expect(result).toEqual({ v: 1, kind: 'pass', reason: 'no_sheet', forced: false, rolls: [] });
    const line = JSON.parse(readFileSync(audit, 'utf8').trim());
    expect(line).toMatchObject({
      source: 'instinct',
      kind: 'pass',
      reason: 'no_sheet',
      run: 4,
      model_called: true,
    });
  });

  it('a malformed sheet gives pass sheet_invalid and the sheet text never reaches the result', async () => {
    const { stateDir } = volume();
    writeFileSync(join(stateDir, 'sheet.json'), '{"version":1,"secret_field":9}');
    const result = await runInstinct({ GELDAR_INSTINCT_STATE: stateDir }, 1);
    expect(result).toMatchObject({ kind: 'pass', reason: 'sheet_invalid' });
    expect(JSON.stringify(result)).not.toMatch(/secret_field/);
  });

  it('a world address that is not http or https gives pass no_world', async () => {
    const { stateDir } = volume();
    writeFileSync(join(stateDir, 'sheet.json'), STANDARD_SHEET);
    const result = await runInstinct(
      { GELDAR_INSTINCT_STATE: stateDir, GELDAR_MCP_URL: 'ftp://127.0.0.1/p/x' },
      2,
    );
    expect(result).toMatchObject({ kind: 'pass', reason: 'no_world' });
  });

  it('lifeKeyOf is the last path segment of the world address', () => {
    expect(lifeKeyOf('http://proxy-player:8080/p/abc123')).toBe('abc123');
    expect(lifeKeyOf('http://proxy-player:8080/')).toBe('');
  });
});
