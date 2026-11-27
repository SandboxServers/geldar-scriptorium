// The sanity veto (HC-23a): a pre-act check on a call the model made, for the owned loops only. It uses no model call
// of its own. Its one roll is the psyche check; a caught roll vetoes the call once, and the veto text is the fixed kit
// text below. Nothing here runs unless the loop is handed SanityParams, so a run without them is the loop as before.
import { readFileSync } from 'node:fs';
import { check, type RollRecord, rngFor, type Score } from '@geldar/scriptorium-psyche';
import { record } from './record.ts';
import type { ToolCall } from './transport.ts';

/** The veto parameters the supervisor delivers on descriptor 4 (HC-23b). Exactly these five keys. */
export interface SanityParams {
  v: 1;
  life: string;
  common_sense: 1 | 2 | 3 | 4 | 5;
  rolls: boolean;
  arm: string;
}

/** The four checks of brief 5.8. */
export type SanityCheck =
  | 'night_exposure'
  | 'starving_with_food'
  | 'fighting_near_death'
  | 'full_inventory';

/** A call the model made, with its arguments parsed (empty when they were not an object). */
export interface PendingCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** What the loop last saw of the world. A field it cannot read is null, and a check that needs it is skipped. */
export interface SanityView {
  night: boolean | null;
  outdoors: boolean | null;
  health: number | null;
  hunger: number | null;
  foodCarried: boolean | null;
  inventoryFull: boolean | null;
  shelterCarried: boolean | null;
}

/** The fixed text a vetoed call answers with: plain facts, nothing else. OD-B approved 2026-11-27 (decision 0289 once the follow-up lands). */
export const VETO_TEXT: Record<SanityCheck, string> = {
  night_exposure: 'It is night and you have no shelter.',
  starving_with_food: 'You are hungry and you carry food.',
  fighting_near_death: 'You are badly hurt.',
  full_inventory: 'Your pack is full.',
};

/** The distance over which a night trip outdoors without shelter is a hit (blocks). */
const NIGHT_TRAVEL_BLOCKS = 64;
/** The hunger and health floor at or below which a check can hit (the standard floor). */
const FLOOR = 6;
/** The DC of every sanity check. */
const SANITY_DC = 8;
/** The longest params file read from the descriptor. */
const PARAMS_MAX_BYTES = 4096;
/** The world tools whose answers the veto reads. */
const OBSERVING = ['status', 'look'];

/** The intent a call makes: the `program` of an `act` call, or null. The world's vocabulary is unconfirmed. */
function intentOf(call: PendingCall): string | null {
  if (call.name !== 'act') return null;
  const program = call.arguments.program;
  return typeof program === 'string' ? program : null;
}

/** The pending call the veto judges, from the raw call the model sent. Unparseable arguments judge as empty. */
export function pendingCall(call: ToolCall): PendingCall {
  let args: unknown = {};
  try {
    args = JSON.parse(call.arguments);
  } catch {
    args = {};
  }
  return { name: call.name, arguments: record(args) ? args : {} };
}

/** Whether a tool's answer is one the veto reads (the status or the look of the world). */
export function isObservation(name: string): boolean {
  return OBSERVING.includes(name);
}

/** The checks that hit for one call. A null field skips its check; a hit needs every condition true. */
export function sanityHits(call: PendingCall, view: SanityView): SanityCheck[] {
  const intent = intentOf(call);
  const hits: SanityCheck[] = [];
  if (
    view.night === true &&
    view.outdoors === true &&
    view.shelterCarried === false &&
    intent === 'travel'
  ) {
    const distance = call.arguments.distance;
    if (typeof distance === 'number' && distance > NIGHT_TRAVEL_BLOCKS) hits.push('night_exposure');
  }
  if (
    view.hunger !== null &&
    view.hunger <= FLOOR &&
    view.foodCarried === true &&
    intent !== 'eat'
  ) {
    hits.push('starving_with_food');
  }
  if (view.health !== null && view.health <= FLOOR && intent === 'attack')
    hits.push('fighting_near_death');
  if (view.inventoryFull === true && intent === 'gather') hits.push('full_inventory');
  return hits;
}

/**
 * Judges one call. Each hit is one psyche check on the sanity dice; the first caught hit is the veto when the
 * allowance allows it (one more call remains after this one, and no veto was spent in this decision). A caught hit
 * that is not allowed runs the call, as does a call with no caught hit.
 */
export function vetoOrRun(
  call: PendingCall,
  view: SanityView,
  params: SanityParams,
  tick: number,
  allowance: { used: number; max: number },
  vetoedAlready: boolean,
): { veto: SanityCheck | null; roll: RollRecord[] } {
  const allowed = !vetoedAlready && allowance.used + 1 < allowance.max;
  const rolls: RollRecord[] = [];
  for (const hit of sanityHits(call, view)) {
    const n = rolls.length;
    const rng = rngFor({
      lifeId: params.life,
      producer: 'kit',
      generation: 0,
      tick,
      fx: 'sanity',
      decisionSeq: n,
    });
    const out = check(
      'sanity',
      params.common_sense as Score,
      SANITY_DC,
      rng,
      n,
      params.life,
      tick,
      {
        prof: 0,
        rolls: params.rolls,
      },
    );
    rolls.push(out.roll);
    if (out.success) return { veto: allowed ? hit : null, roll: rolls };
  }
  return { veto: null, roll: rolls };
}

/** A boolean field of a parsed status, or null when it is absent or of another type. */
const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

/** A number field of a parsed status, or null when it is absent or of another type. */
const amount = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/**
 * Builds the view from the text of the last status or look answer. The adapter is this one function: the world's
 * field names are unconfirmed, so every field it cannot read is null (and its check is skipped).
 */
export function viewFromStatus(text: string | null): SanityView {
  const view: SanityView = {
    night: null,
    outdoors: null,
    health: null,
    hunger: null,
    foodCarried: null,
    inventoryFull: null,
    shelterCarried: null,
  };
  if (text === null) return view;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return view;
  }
  if (!record(parsed)) return view;
  view.night = flag(parsed.night);
  view.outdoors = flag(parsed.outdoors);
  view.health = amount(parsed.health);
  view.hunger = amount(parsed.hunger);
  view.foodCarried = flag(parsed.food_carried);
  view.inventoryFull = flag(parsed.inventory_full);
  view.shelterCarried = flag(parsed.shelter_carried);
  return view;
}

/** Checks the five keys and their types. Anything else is no params. */
function paramsOf(value: unknown): SanityParams | null {
  if (!record(value)) return null;
  const keys = Object.keys(value).sort().join(',');
  if (keys !== 'arm,common_sense,life,rolls,v') return null;
  const { v, life, common_sense: sense, rolls, arm } = value;
  if (v !== 1 || typeof rolls !== 'boolean' || typeof arm !== 'string') return null;
  if (typeof life !== 'string' || life === '' || life.includes(':')) return null;
  if (typeof sense !== 'number' || ![1, 2, 3, 4, 5].includes(sense)) return null;
  return { v: 1, life, common_sense: sense as SanityParams['common_sense'], rolls, arm };
}

/**
 * Reads the veto parameters from a descriptor (4 by default). Null on any error, EBADF included, and on any
 * parameter that does not match SanityParams: the loop then runs as it did before the veto.
 */
export function readSanityParams(fd = 4): SanityParams | null {
  let text: string;
  try {
    text = readFileSync(fd, 'utf8');
  } catch {
    return null;
  }
  if (Buffer.byteLength(text, 'utf8') > PARAMS_MAX_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return paramsOf(value);
}
