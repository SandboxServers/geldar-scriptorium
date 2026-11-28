// The veto parameters the supervisor hands the owned loop on descriptor 4 (HC-23b). The loop reads exactly the five
// SanityParams keys (mind-loop's sanity.ts) and nothing else from the sheet. Nothing is delivered unless the instinct
// step, its sanity switch and a non-claude harness are all on.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { lifeKeyOf, readSheetFile } from '@geldar/scriptorium-instinct';
import type { Settings } from './settings.ts';
import { writePrivate } from './state.ts';

type Env = Readonly<Record<string, string | undefined>>;

/** The sheet the instinct step reads (the result of readSheetFile). */
type Sheet = NonNullable<ReturnType<typeof readSheetFile>>;

/** The veto parameters the loop reads on descriptor 4: exactly these five keys (the loop's SanityParams). */
export interface SanityParams {
  v: 1;
  life: string;
  common_sense: 1 | 2 | 3 | 4 | 5;
  rolls: boolean;
  arm: string;
}

/** The parameters for one life: the common sense score is the only sheet field that crosses over. */
export function deriveSanityParams(
  settings: Settings,
  sheet: Sheet,
  lifeKey: string,
): SanityParams {
  return {
    v: 1,
    life: lifeKey,
    common_sense: sheet.attributes.common_sense,
    rolls: settings.instinct.rolls,
    arm: settings.instinct.arm,
  };
}

/**
 * The life key of the player (the last segment of the world address, as the instinct step keys it), or null
 * when there is none the loop would accept (empty, or one with a colon).
 */
export function sanityLifeKey(env: Env): string | null {
  try {
    const key = lifeKeyOf(env.GELDAR_MCP_URL ?? '');
    return key === '' || key.includes(':') ? null : key;
  } catch {
    return null;
  }
}

/**
 * Writes `instinct/sanity.json` (0600) for waking `uid`'s run and returns its path, to be handed on descriptor 4.
 * Returns null and delivers nothing when sanity is off, the harness is claude, or there is no usable sheet or life
 * key. An invalid sheet is reported by the instinct step (`sheet_invalid`), not here.
 */
export function writeSanityParams(
  settings: Settings,
  env: Env,
  uid: number | undefined,
): string | null {
  const dir = join(settings.stateDir, 'instinct');
  const file = join(dir, 'sanity.json');
  const i = settings.instinct;
  if (!i.enabled || !i.sanity || settings.harness === 'claude') return null;
  const sheet = readSheetFile(dir, uid);
  const life = sanityLifeKey(env);
  if (sheet === null || life === null) {
    rmSync(file, { force: true });
    return null;
  }
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writePrivate(file, `${JSON.stringify(deriveSanityParams(settings, sheet, life))}\n`);
  } catch {
    // An unwritable state folder delivers nothing: the loop then runs as it did before the veto.
    return null;
  }
  return file;
}
