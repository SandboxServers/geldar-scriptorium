// The real `geldar-instinct` child against the fake world on 127.0.0.1: the step's outcomes as the supervisor sees
// them (one JSON line on stdout, one audit line, world calls). In-process tests of the same logic are in run.test.ts.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { type FakeWorld, startFakeWorld } from './fake-world.fixture.ts';

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
/** The standard sheet: every score 3 (the same fixture as run.test.ts). */
const STANDARD_SHEET = JSON.stringify({
  version: 1,
  attributes: { curiosity: 3, common_sense: 3, cleverness: 3, aggression: 3 },
  alignment: { law: 3, good: 3 },
  op_modes: { explorer: 3, farmer: 3, miner: 3, builder: 3, crafter: 3, warrior: 3, nitwit: 3 },
});
/** A wait reply with one agent in view that the step has never seen: a forced pass (first_sighting). */
const FIRST_SIGHTING = JSON.stringify({
  snapshot: { surroundings: { agents: [{ name: 'Ann', distance: 3 }] } },
});

let world: FakeWorld | undefined;

afterEach(async () => {
  await world?.close();
  world = undefined;
});

/** A fresh instinct directory under a volume root, as the supervisor lays it out (`<root>/instinct`). */
function volume(sheet: string | null): { stateDir: string; audit: string } {
  const root = mkdtempSync(join(tmpdir(), 'instinct-int-'));
  const stateDir = join(root, 'instinct');
  mkdirSync(stateDir, { recursive: true });
  if (sheet !== null) writeFileSync(join(stateDir, 'sheet.json'), sheet, { mode: 0o600 });
  return { stateDir, audit: join(root, 'instinct.jsonl') };
}

/** Runs `geldar-instinct run --run 1` with only the step's environment (no inherited secrets). */
function runChild(env: Record<string, string>): Promise<{ code: number | null; stdout: string }> {
  const inherited: Record<string, string> = {};
  for (const key of ['PATH', 'SystemRoot']) {
    const value = process.env[key];
    if (value !== undefined) inherited[key] = value;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'run', '--run', '1'], {
      env: { ...inherited, ...env },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const timer = setTimeout(() => child.kill(), 25_000);
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout });
    });
  });
}

describe('geldar-instinct child against the fake world', () => {
  it('a first sighting forces a model pass: one wait, no act, one audit line', async () => {
    const { stateDir, audit } = volume(STANDARD_SHEET);
    world = await startFakeWorld({ wait: [FIRST_SIGHTING] });
    const { code, stdout } = await runChild({
      GELDAR_INSTINCT_STATE: stateDir,
      GELDAR_MCP_URL: world.url,
      GELDAR_MCP_TOKEN: 'test-token',
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout.trim())).toMatchObject({
      kind: 'pass',
      reason: 'first_sighting',
      forced: true,
    });
    expect(world.calls.map((c) => c.name)).toEqual(['wait']);
    expect(readFileSync(audit, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('no world at the address: pass no_world, exit 0, nothing acted', async () => {
    const { stateDir } = volume(STANDARD_SHEET);
    world = await startFakeWorld();
    // Port 1 on loopback is closed here: the connect is refused and the step falls back to the model.
    const { code, stdout } = await runChild({
      GELDAR_INSTINCT_STATE: stateDir,
      GELDAR_MCP_URL: 'http://127.0.0.1:1/p/life1',
      GELDAR_MCP_TOKEN: 'test-token',
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout.trim())).toMatchObject({ kind: 'pass', reason: 'no_world' });
    expect(world.calls).toEqual([]);
  });

  it('a malformed sheet: pass sheet_invalid, no world contact, the sheet text never reaches stdout', async () => {
    const { stateDir } = volume('{"version":1,"secret_field":9}');
    world = await startFakeWorld({ wait: [FIRST_SIGHTING] });
    const { code, stdout } = await runChild({
      GELDAR_INSTINCT_STATE: stateDir,
      GELDAR_MCP_URL: world.url,
      GELDAR_MCP_TOKEN: 'test-token',
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout.trim())).toMatchObject({ kind: 'pass', reason: 'sheet_invalid' });
    expect(stdout).not.toContain('secret_field');
    expect(world.calls).toEqual([]);
  });

  it('no sheet file: pass no_sheet and no world contact', async () => {
    const { stateDir } = volume(null);
    world = await startFakeWorld({ wait: [FIRST_SIGHTING] });
    const { code, stdout } = await runChild({
      GELDAR_INSTINCT_STATE: stateDir,
      GELDAR_MCP_URL: world.url,
      GELDAR_MCP_TOKEN: 'test-token',
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout.trim())).toMatchObject({ kind: 'pass', reason: 'no_sheet' });
    expect(world.calls).toEqual([]);
  });
});
