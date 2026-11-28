import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { childEnv } from './child.ts';
import { makeFixture, onPoll } from './fixture.ts';
import { readSettings } from './settings.ts';

// The blind proof (HC-26c): the sheet never reaches the model child. The sheet's own text carries the
// sentinel; the supervisor's environment carries the names the instinct step uses. No model-child
// environment, argv or working directory may hold any of them.

const SENTINEL = 'sheet-sentinel-5b1d';

/** A valid sheet (every score 3), the kind the operator stores for the player. */
const VALID_SHEET = JSON.stringify({
  version: 1,
  attributes: { curiosity: 3, common_sense: 3, cleverness: 3, aggression: 3 },
  alignment: { law: 3, good: 3 },
  op_modes: { explorer: 3, farmer: 3, miner: 3, builder: 3, crafter: 3, warrior: 3, nitwit: 3 },
});

/** The supervisor's environment: instinct names, the sentinel, and the two model credentials. */
const PROC_ENV: Record<string, string> = {
  PATH: '/usr/bin',
  HOME: '/root',
  GELDAR_INSTINCT: 'on',
  GELDAR_INSTINCT_SANITY: 'on',
  GELDAR_INSTINCT_STATE: `/state/${SENTINEL}`,
  GELDAR_SHEET: SENTINEL,
  CLAUDE_CODE_OAUTH_TOKEN: 'oauth-5b1d',
  GELDAR_MCP_TOKEN: 'mcp-5b1d',
  GELDAR_LOCAL_API_KEY: 'local-key-5b1d',
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('the sheet never reaches the model child', () => {
  it.each(['claude', 'chatgpt', 'local'] as const)(
    'childEnv for %s has no SHEET or INSTINCT name and no sentinel value',
    (harness) => {
      const settings = readSettings({
        GELDAR_HARNESS: harness,
        GELDAR_RUN_MODEL: 'account-model',
        GELDAR_LOCAL_BASE_URL: 'http://127.0.0.1:8080/v1',
        GELDAR_LOCAL_CONTEXT_TOKENS: '8192',
        GELDAR_LOCAL_IMAGES: 'false',
      });
      const env = childEnv(settings, PROC_ENV);
      expect(Object.keys(env).filter((key) => /SHEET|INSTINCT/i.test(key))).toEqual([]);
      expect(Object.values(env).filter((value) => value.includes(SENTINEL))).toEqual([]);
    },
  );

  it('a fixture run: the model argv and cwd hold neither the sentinel, sheet.json nor the state path', async () => {
    const f = makeFixture({ last: 'done', stopAt: 1 }, { GELDAR_INSTINCT: 'on' }, PROC_ENV);
    roots.push(f.root);
    // The sheet sits in the instinct state folder: <supervisor state>/instinct/sheet.json.
    mkdirSync(join(f.stateDir, 'instinct'), { recursive: true });
    writeFileSync(join(f.stateDir, 'instinct', 'sheet.json'), VALID_SHEET, { mode: 0o600 });
    onPoll(f, () => f.supervisor.requestStop());
    expect(await f.supervisor.run()).toBe(0);
    const run = f.runs()[0];
    expect(run).toBeDefined();
    // The prompt path is a separate field of the spec (not argv), so it is the one path allowed to sit in state.
    const seen = [...(run?.args ?? []), run?.cwd ?? ''].join('\n');
    expect(seen).not.toContain(SENTINEL);
    expect(seen).not.toContain('sheet.json');
    expect(seen).not.toContain(f.stateDir);
  });

  // HC-23b: the chatgpt loop process and its descriptor 4 are built there. This case is the proof's last
  // case and stays skipped until HC-23b merges.
  it.skip('chatgpt with sanity on: the loop process receives exactly the five SanityParams keys on descriptor 4 and none of aggression, curiosity, cleverness, law, good, op_modes', () => {
    // Skipped until HC-23b (the sanity descriptor) merges.
  });
});
