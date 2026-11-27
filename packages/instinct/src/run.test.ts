import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Fx } from './decide.ts';
import { failureFx, problemKey } from './fx/failure.ts';
import { lifeKeyOf, OWN_ACT_LINE, runInstinct } from './run.ts';
import { emptyState, type InstinctState, loadState } from './state.ts';
import type { WorldLink } from './world.ts';

/** The sheet's field names (brief 3.2). A word match, so "good" in a longer word is not a hit. */
const SHEET_WORDS = /\b(curiosity|common_sense|cleverness|aggression|law|good|op_modes)\b/;
const WORLD_ENV = { GELDAR_MCP_URL: 'http://proxy-player:8080/p/life1' };
const ACCEPTED = JSON.stringify({ accepted: [{ id: 'a1' }], rejected: [] });
const REJECTED = JSON.stringify({ accepted: [], rejected: [{ reason: 'no' }] });
const FIRST_SIGHTING = JSON.stringify({
  snapshot: { surroundings: { agents: [{ name: 'Ann', distance: 3 }] } },
});
/** A fx that always offers one act (the only way a settle can happen in these tests). */
const ACT_FX: Fx = () => ({
  kind: 'act',
  fx: 'idle',
  why: 'habit for the top goal',
  act: { tool: 'act', arguments: { program: 'walk' } },
});

/** A world whose wait returns waitText and whose act returns actText. `calls` records every tool name. */
function fakeWorld(
  waitText: string,
  actText: string,
): { connect: () => Promise<WorldLink>; calls: string[] } {
  const calls: string[] = [];
  const link: WorldLink = {
    async call(name) {
      calls.push(name);
      return name === 'act' ? actText : waitText;
    },
    async close() {},
  };
  return { connect: async () => link, calls };
}

function writeState(stateDir: string, patch: Partial<InstinctState>): void {
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify({ ...emptyState(), ...patch }));
}

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

describe('runInstinct last intent across wakings', () => {
  it('last_intent is stored after a run and the next run failure fx uses it', async () => {
    const { stateDir } = volume();
    writeFileSync(join(stateDir, 'sheet.json'), STANDARD_SHEET);
    const running = JSON.stringify({
      snapshot: { current_plan: { goal: 'find food', action: 'mine', status: 'running' } },
    });
    const failed = JSON.stringify({
      events: [{ seq: 2, type: 'intent_failed', tick: 5, text: 'Your intent failed: no path' }],
    });
    const env = { GELDAR_INSTINCT_STATE: stateDir, ...WORLD_ENV };
    await runInstinct(env, 1, new Date(), fakeWorld(running, ACCEPTED).connect, [failureFx]);
    expect(loadState(stateDir).last_intent).toEqual({
      goal: 'find food',
      program: 'mine',
      arguments: { status: 'running' },
    });
    await runInstinct(env, 2, new Date(), fakeWorld(failed, ACCEPTED).connect, [failureFx]);
    expect(loadState(stateDir).attempts[problemKey('find food', 'mine')]).toBe(1);
  });
});

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

describe('runInstinct with a world (injected connect and fx list)', () => {
  it('a non-forced pass with pending own acts becomes pass-with-facts fx none and clears them', async () => {
    const { stateDir } = volume();
    writeFileSync(join(stateDir, 'sheet.json'), STANDARD_SHEET);
    writeState(stateDir, { pending_acts: [OWN_ACT_LINE] });
    const { connect } = fakeWorld('{}', ACCEPTED);
    const result = await runInstinct(
      { GELDAR_INSTINCT_STATE: stateDir, ...WORLD_ENV },
      3,
      new Date(),
      connect,
    );
    expect(result).toMatchObject({
      kind: 'pass-with-facts',
      fx: 'none',
      facts: [expect.any(String)],
    });
    expect(loadState(stateDir).pending_acts).toEqual([]);
  });

  it('a forced pass leaves pending own acts untouched for the next non-forced result', async () => {
    const { stateDir } = volume();
    writeFileSync(join(stateDir, 'sheet.json'), STANDARD_SHEET);
    writeState(stateDir, { pending_acts: [OWN_ACT_LINE] });
    const { connect } = fakeWorld(FIRST_SIGHTING, ACCEPTED);
    const result = await runInstinct(
      { GELDAR_INSTINCT_STATE: stateDir, ...WORLD_ENV },
      3,
      new Date(),
      connect,
    );
    expect(result).toMatchObject({ kind: 'pass', reason: 'first_sighting', forced: true });
    expect(loadState(stateDir).pending_acts).toEqual([OWN_ACT_LINE]);
  });

  it('a rejected act gives send_failed, never settles as accepted, and keeps pending acts', async () => {
    const { stateDir, audit } = volume();
    writeFileSync(join(stateDir, 'sheet.json'), STANDARD_SHEET);
    writeState(stateDir, { pending_acts: [OWN_ACT_LINE] });
    const { connect, calls } = fakeWorld('{}', REJECTED);
    const result = await runInstinct(
      { GELDAR_INSTINCT_STATE: stateDir, ...WORLD_ENV },
      5,
      new Date(),
      connect,
      [ACT_FX],
    );
    expect(calls).toEqual(['wait', 'act']);
    expect(result).toMatchObject({ kind: 'pass', reason: 'send_failed' });
    expect(JSON.stringify(result)).not.toMatch(/"accepted":true/);
    expect(loadState(stateDir).pending_acts).toEqual([OWN_ACT_LINE]);
    expect(JSON.parse(readFileSync(audit, 'utf8').trim())).toMatchObject({
      kind: 'pass',
      reason: 'send_failed',
      act: null,
      world: null,
    });
  });

  it('an accepted act settles with the fixed own-act line and stores it as pending', async () => {
    const { stateDir } = volume();
    writeFileSync(join(stateDir, 'sheet.json'), STANDARD_SHEET);
    const { connect } = fakeWorld('{}', ACCEPTED);
    const result = await runInstinct(
      { GELDAR_INSTINCT_STATE: stateDir, ...WORLD_ENV },
      5,
      new Date(),
      connect,
      [ACT_FX],
    );
    expect(result).toMatchObject({ kind: 'settle', world: { accepted: true, line: OWN_ACT_LINE } });
    expect(loadState(stateDir).pending_acts).toEqual([OWN_ACT_LINE]);
  });

  it('a wait with a death event gives pass dead and no act is sent', async () => {
    const { stateDir } = volume();
    writeFileSync(join(stateDir, 'sheet.json'), STANDARD_SHEET);
    const deathWait = JSON.stringify({
      events: [{ seq: 1, type: 'death', tick: 4, text: 'You died.' }],
    });
    const { connect, calls } = fakeWorld(deathWait, ACCEPTED);
    const result = await runInstinct(
      { GELDAR_INSTINCT_STATE: stateDir, ...WORLD_ENV },
      7,
      new Date(),
      connect,
      [ACT_FX],
    );
    expect(result).toMatchObject({ kind: 'pass', reason: 'dead' });
    expect(calls).toEqual(['wait']);
  });

  it('the audit line of a run with a valid sheet holds no sheet field name', async () => {
    const { stateDir, audit } = volume();
    writeFileSync(join(stateDir, 'sheet.json'), STANDARD_SHEET);
    const { connect } = fakeWorld('{}', ACCEPTED);
    await runInstinct({ GELDAR_INSTINCT_STATE: stateDir, ...WORLD_ENV }, 6, new Date(), connect);
    expect(readFileSync(audit, 'utf8')).not.toMatch(SHEET_WORDS);
  });
});
