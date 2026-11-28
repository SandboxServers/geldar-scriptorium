import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSheetFile } from '@geldar/scriptorium-instinct';
import { afterEach, describe, expect, it } from 'vitest';
import { VETO_TEXT } from '../../mind-loop/src/sanity.ts';
import { deriveSanityParams, sanityLifeKey, writeSanityParams } from './sanity.ts';
import { readSettings, SettingError, type Settings } from './settings.ts';

type Sheet = NonNullable<ReturnType<typeof readSheetFile>>;

// The veto parameters on descriptor 4 (HC-23b). The loop reads exactly the five SanityParams keys; the sheet's
// other fields never leave the supervisor.

const VALID_SHEET = {
  version: 1,
  attributes: { curiosity: 2, common_sense: 4, cleverness: 3, aggression: 1 },
  alignment: { law: 5, good: 2 },
  op_modes: { explorer: 1, farmer: 2, miner: 3, builder: 4, crafter: 5, warrior: 1, nitwit: 2 },
};

const LIFE_ENV = { GELDAR_MCP_URL: 'http://world.test/p/player-1' };
const FIVE_KEYS = ['arm', 'common_sense', 'life', 'rolls', 'v'];

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Settings for one harness with the instinct step and sanity on, over a fresh state folder. */
function settingsFor(harness: string, extra: Record<string, string> = {}): Settings {
  const root = mkdtempSync(join(tmpdir(), 'sanity-sup-'));
  roots.push(root);
  return readSettings({
    GELDAR_SUPERVISOR_STATE: join(root, 'state'),
    GELDAR_HARNESS: harness,
    GELDAR_INSTINCT: 'on',
    GELDAR_INSTINCT_SANITY: 'on',
    ...extra,
  });
}

/** Writes the sheet where the instinct step reads it (0600, owned by this process). */
function putSheet(settings: Settings, text: string): void {
  const dir = join(settings.stateDir, 'instinct');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sheet.json'), text, { mode: 0o600 });
}

describe('the veto sentences', () => {
  it('are the four approved sentences, byte-identical to the loop text', () => {
    expect(VETO_TEXT).toEqual({
      night_exposure: 'It is night and you have no shelter.',
      starving_with_food: 'You are hungry and you carry food.',
      fighting_near_death: 'You are badly hurt.',
      full_inventory: 'Your pack is full.',
    });
  });
});

describe('the sanity switch', () => {
  it('is off by default: GELDAR_INSTINCT_SANITY unset reads as off', () => {
    expect(readSettings({ GELDAR_INSTINCT: 'on' }).instinct.sanity).toBe(false);
  });

  it('reads as on only when set to exactly on, and refuses any other value', () => {
    expect(readSettings({ GELDAR_INSTINCT_SANITY: 'on' }).instinct.sanity).toBe(true);
    expect(readSettings({ GELDAR_INSTINCT_SANITY: 'off' }).instinct.sanity).toBe(false);
    expect(() => readSettings({ GELDAR_INSTINCT_SANITY: 'x' })).toThrow(SettingError);
  });
});

describe('deriveSanityParams', () => {
  it('gives exactly the five SanityParams keys, with common sense from the sheet', () => {
    const settings = settingsFor('chatgpt');
    putSheet(settings, JSON.stringify(VALID_SHEET));
    const sheet = readSheetFile(join(settings.stateDir, 'instinct'), process.getuid?.());
    expect(sheet).not.toBeNull();
    const params = deriveSanityParams(settings, sheet as Sheet, 'player-1');
    expect(Object.keys(params).sort()).toEqual(FIVE_KEYS);
    expect(params).toEqual({
      v: 1,
      life: 'player-1',
      common_sense: 4,
      rolls: true,
      arm: 'instinct',
    });
  });
});

describe('writeSanityParams', () => {
  it('a chatgpt run with sanity on writes instinct/sanity.json and names it for descriptor 4', () => {
    const settings = settingsFor('chatgpt');
    putSheet(settings, JSON.stringify(VALID_SHEET));
    const file = writeSanityParams(settings, LIFE_ENV, process.getuid?.());
    expect(file).toBe(join(settings.stateDir, 'instinct', 'sanity.json'));
    const text = readFileSync(file ?? '', 'utf8');
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(FIVE_KEYS);
    expect(text).not.toMatch(/aggression|curiosity|cleverness|law|good|op_modes/);
    if (process.platform !== 'win32') expect(statSync(file ?? '').mode & 0o777).toBe(0o600);
  });

  it('claude harness: no fd 4, no sanity.json', () => {
    const settings = settingsFor('claude');
    putSheet(settings, JSON.stringify(VALID_SHEET));
    expect(writeSanityParams(settings, LIFE_ENV, process.getuid?.())).toBeNull();
    expect(() => readFileSync(join(settings.stateDir, 'instinct', 'sanity.json'))).toThrow();
  });

  it('instinct off, and sanity off: nothing is delivered', () => {
    const off = settingsFor('chatgpt', { GELDAR_INSTINCT_SANITY: 'off' });
    putSheet(off, JSON.stringify(VALID_SHEET));
    expect(writeSanityParams(off, LIFE_ENV, process.getuid?.())).toBeNull();
    const noInstinct = settingsFor('chatgpt', { GELDAR_INSTINCT: 'off' });
    putSheet(noInstinct, JSON.stringify(VALID_SHEET));
    expect(writeSanityParams(noInstinct, LIFE_ENV, process.getuid?.())).toBeNull();
  });

  it('an invalid sheet delivers nothing', () => {
    const settings = settingsFor('chatgpt');
    putSheet(settings, '{"version":1}');
    expect(writeSanityParams(settings, LIFE_ENV, process.getuid?.())).toBeNull();
  });

  it('no usable life key delivers nothing', () => {
    const settings = settingsFor('chatgpt');
    putSheet(settings, JSON.stringify(VALID_SHEET));
    expect(writeSanityParams(settings, {}, process.getuid?.())).toBeNull();
    expect(sanityLifeKey({ GELDAR_MCP_URL: 'not a url' })).toBeNull();
    expect(sanityLifeKey(LIFE_ENV)).toBe('player-1');
  });
});
