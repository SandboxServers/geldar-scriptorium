// The only file that knows the world's wait shapes: mcp-play.schema.json WaitResult, mcp-common.schema.json PlaySnapshot,
// McpPlayerEvent and UntrustedWorldText. Fields the world does not give are null, {} or []. Event text is untrusted: it is
// classified and truncated, never executed or copied into a fact.
//
// OPEN ISSUE (interference, not fixed here): a `wait` marks the events it returns as delivered in the shared world state
// (threshold/mcp wait.ts rememberDelivered). So an instinct wait can hide events from the model's later cursorless wait.
// This step cannot prevent it; a world-side card must decide how instinct waits are scoped.
//
// Not given by the world: tick (null), dead (false; death is an event of type `death`), inventory_full (null).
// The status tool is not called: it holds budget, days and law lines only.

export type EventKind =
  | 'speech_to_me'
  | 'intent_finished'
  | 'intent_failed'
  | 'action_failed'
  | 'hurt'
  | 'death'
  | 'other';

export interface EventLine {
  kind: EventKind;
  text: string;
  from?: string;
}

export interface Observation {
  tick: number | null;
  dead: boolean;
  night: boolean | null;
  position: { x: number; y: number; z: number } | null;
  health: number | null;
  hunger: number | null;
  inventory: Record<string, number>;
  foodCarried: boolean | null;
  inventoryFull: boolean | null;
  agents: { name: string; distance: number | null }[];
  entities: { kind: string; hostile: boolean; distance: number | null }[];
  notable: { kind: string; distance: number | null }[];
  /** The current plan of the Body, read from current_plan: program is its action, arguments hold its status. */
  intent: { goal: string; program: string; arguments: Record<string, unknown> } | null;
  events: EventLine[];
  cursor: string | null;
}

/** The one call the instinct step makes to the world. A thin structural type so tests can pass a fake. */
export interface WorldCalls {
  call(name: string, args: Record<string, unknown>): Promise<string>;
}

/** The shortest wait the contract allows (mcp-play.schema.json WaitInput max_seconds minimum). */
export const WAIT_SECONDS = 5;
/** The error message the world link throws for a bad_cursor refusal (see world.ts). */
export const BAD_CURSOR = 'bad_cursor';

const MAX_EVENT_CHARS = 200;
const CURSOR = /^c_[0-9]{1,12}$/;

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The parsed reply, or null when the text is not one JSON object (then the lines are classified instead). */
function parseJson(text: string): Obj | null {
  try {
    const value: unknown = JSON.parse(text);
    return isObj(value) ? value : null;
  } catch {
    return null;
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Classify one event by its type, then by its text for the bare lines (no type). `from` is the speaker for a
 * speech_to_me event. Text is cut to 200 characters.
 */
export function classifyEvent(type: string, rawText: string, from: string | null): EventLine {
  const text = rawText.trim().slice(0, MAX_EVENT_CHARS);
  if (type === 'speech_to_me') return { kind: 'speech_to_me', text, from: from ?? '' };
  if (type === 'intent_finished' || text === 'Your intent finished.') {
    return { kind: 'intent_finished', text };
  }
  if (type === 'action_failed') return { kind: 'action_failed', text };
  if (/^Your intent (failed|ran out of time)/.test(text) || /^Your plan stopped: /.test(text)) {
    return { kind: 'intent_failed', text };
  }
  if (type === 'damage' || type === 'hurt') return { kind: 'hurt', text };
  if (type === 'death') return { kind: 'death', text };
  return { kind: 'other', text };
}

function eventsOf(w: Obj | null, waitText: string, speaker: string | null): EventLine[] {
  if (w === null) {
    return waitText
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => classifyEvent('', line, null));
  }
  if (!Array.isArray(w.events)) return [];
  return w.events.flatMap((e) =>
    isObj(e) && str(e.type) !== null && str(e.text) !== null
      ? [classifyEvent(str(e.type) as string, str(e.text) as string, speaker)]
      : [],
  );
}

function agentsOf(value: unknown): Observation['agents'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((a) =>
    isObj(a) && str(a.name) !== null
      ? [{ name: str(a.name) as string, distance: num(a.distance) }]
      : [],
  );
}

function entitiesOf(value: unknown): Observation['entities'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((e) =>
    isObj(e) && str(e.type) !== null
      ? [{ kind: str(e.type) as string, hostile: e.hostile === true, distance: num(e.distance) }]
      : [],
  );
}

/** Notable blocks carry no distance in the contract, so distance is always null here. */
function notableOf(value: unknown): Observation['notable'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((n) =>
    isObj(n) && str(n.type) !== null ? [{ kind: str(n.type) as string, distance: null }] : [],
  );
}

function positionOf(value: unknown): Observation['position'] {
  if (!isObj(value)) return null;
  const x = num(value.x);
  const y = num(value.y);
  const z = num(value.z);
  return x !== null && y !== null && z !== null ? { x, y, z } : null;
}

/** The inventory is an array of {item, count, edible?}; counts of the same item are summed. */
function inventoryOf(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(value)) return out;
  for (const stack of value) {
    if (!isObj(stack) || str(stack.item) === null || num(stack.count) === null) continue;
    const item = stack.item as string;
    out[item] = (out[item] ?? 0) + (num(stack.count) as number);
  }
  return out;
}

function planOf(value: unknown): Observation['intent'] {
  if (!isObj(value) || str(value.goal) === null || str(value.action) === null) return null;
  return {
    goal: value.goal as string,
    program: value.action as string,
    arguments: { status: str(value.status) ?? '' },
  };
}

/**
 * The one function that knows the shapes. `waitText` is the wait reply (JSON WaitResult); a plain-text reply is
 * read line by line. Missing fields come out null, {} or [].
 */
export function parseObservation(waitText: string): Observation {
  const w = parseJson(waitText);
  const body: Obj = w ?? {};
  const snap = isObj(body.snapshot) ? body.snapshot : {};
  const self = isObj(snap.self) ? snap.self : {};
  const surroundings = isObj(snap.surroundings) ? snap.surroundings : {};
  const worldTime = isObj(snap.world_time) ? snap.world_time : null;
  const untrusted = isObj(body.untrusted_world_text) ? body.untrusted_world_text : {};
  const speech = Array.isArray(untrusted.speech) ? untrusted.speech : [];
  const firstSpeech = speech.find(isObj);
  const speaker = firstSpeech ? str(firstSpeech.from) : null;
  const inventory = self.inventory;
  const cursor = str(body.cursor);
  return {
    tick: null,
    dead: false,
    night: worldTime ? worldTime.time_of_day === 'night' : null,
    position: positionOf(self.position),
    health: num(self.health),
    hunger: num(self.hunger),
    inventory: inventoryOf(inventory),
    foodCarried: Array.isArray(inventory)
      ? inventory.some((s) => isObj(s) && s.edible === true)
      : null,
    inventoryFull: null,
    agents: agentsOf(surroundings.agents),
    entities: entitiesOf(surroundings.entities),
    notable: notableOf(surroundings.notable_blocks),
    intent: planOf(snap.current_plan),
    events: eventsOf(w, waitText, speaker),
    cursor: cursor !== null && CURSOR.test(cursor) ? cursor : null,
  };
}

/**
 * One wait of WAIT_SECONDS from the given cursor. A bad_cursor refusal is retried once with no cursor, so a stale
 * cursor cannot wedge the step; the caller stores the cursor of whichever reply it got.
 */
export async function observe(world: WorldCalls, cursor: string | null): Promise<Observation> {
  const waitArgs = (c: string | null): Record<string, unknown> =>
    c === null ? { max_seconds: WAIT_SECONDS } : { max_seconds: WAIT_SECONDS, cursor: c };
  try {
    return parseObservation(await world.call('wait', waitArgs(cursor)));
  } catch (err) {
    if (cursor === null || !(err instanceof Error) || err.message !== BAD_CURSOR) throw err;
    return parseObservation(await world.call('wait', waitArgs(null)));
  }
}
