// The only file that knows the world's output shape. Every field name of the status and wait replies is (to confirm)
// against the geldar tool schema: a wrong guess is a one-file fix here. Fields the world does not give are null, {} or [].
// Event text is untrusted: it is classified and truncated, never executed or copied into a fact.

export type EventKind =
  | 'speech_to_me'
  | 'speech'
  | 'intent_finished'
  | 'intent_failed'
  | 'action_failed'
  | 'hurt'
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
  intent: { goal: string; program: string; arguments: Record<string, unknown> } | null;
  events: EventLine[];
  cursor: string | null;
}

/** The two calls the instinct step makes to the world. A thin structural type so tests can pass a fake. */
export interface WorldCalls {
  call(name: string, args: Record<string, unknown>): Promise<string>;
}

const MAX_EVENT_CHARS = 200;

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): Obj {
  try {
    const value: unknown = JSON.parse(text);
    return isObj(value) ? value : {};
  } catch {
    return {};
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Classify one plain line of the wait reply. The exact speech marker is (to confirm) against the play skills. */
export function classifyLine(raw: string): EventLine | null {
  const text = raw.trim().slice(0, MAX_EVENT_CHARS);
  if (text === '') return null;
  if (text === 'Your intent finished.') return { kind: 'intent_finished', text };
  if (text === 'Your intent ran out of time.' || /^Your intent failed: /.test(text)) {
    return { kind: 'intent_failed', text };
  }
  if (/^Your [a-z_ ]+ failed: /.test(text)) return { kind: 'action_failed', text };
  const addressed = /^(.{1,40}?) says to you: /.exec(text);
  if (addressed) return { kind: 'speech_to_me', text, from: addressed[1] as string };
  const said = /^(.{1,40}?) says: /.exec(text);
  if (said) return { kind: 'speech', text, from: said[1] as string };
  if (/^You were hurt/.test(text)) return { kind: 'hurt', text };
  return { kind: 'other', text };
}

function eventsOf(waitText: string): EventLine[] {
  const json = parseJson(waitText);
  const lines = Array.isArray(json.events)
    ? json.events.filter((e): e is string => typeof e === 'string')
    : waitText.split('\n');
  return lines.map(classifyLine).filter((e): e is EventLine => e !== null);
}

function agentsOf(value: unknown): Observation['agents'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((a) =>
    isObj(a) && str(a.name) ? [{ name: str(a.name) as string, distance: num(a.distance) }] : [],
  );
}

function entitiesOf(value: unknown): Observation['entities'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((e) =>
    isObj(e) && str(e.kind)
      ? [{ kind: str(e.kind) as string, hostile: e.hostile === true, distance: num(e.distance) }]
      : [],
  );
}

function notableOf(value: unknown): Observation['notable'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((n) =>
    isObj(n) && str(n.kind) ? [{ kind: str(n.kind) as string, distance: num(n.distance) }] : [],
  );
}

function positionOf(value: unknown): Observation['position'] {
  if (!isObj(value)) return null;
  const { x, y, z } = value;
  return num(x) !== null && num(y) !== null && num(z) !== null
    ? { x: num(x) as number, y: num(y) as number, z: num(z) as number }
    : null;
}

function inventoryOf(value: unknown): Record<string, number> {
  if (!isObj(value)) return {};
  const out: Record<string, number> = {};
  for (const [item, count] of Object.entries(value))
    if (num(count) !== null) out[item] = num(count) as number;
  return out;
}

function intentOf(value: unknown): Observation['intent'] {
  if (!isObj(value) || !str(value.goal) || !str(value.program)) return null;
  return {
    goal: value.goal as string,
    program: value.program as string,
    arguments: isObj(value.arguments) ? value.arguments : {},
  };
}

/** The one function that knows the shapes. Plain lines in the wait reply are classified; JSON is read when it parses. */
export function parseObservation(statusText: string, waitText: string): Observation {
  const s = parseJson(statusText);
  const w = parseJson(waitText);
  return {
    tick: num(s.tick),
    dead: s.dead === true,
    night: bool(s.night),
    position: positionOf(s.position),
    health: num(s.health),
    hunger: num(s.hunger),
    inventory: inventoryOf(s.inventory),
    foodCarried: bool(s.food_carried),
    inventoryFull: bool(s.inventory_full),
    agents: agentsOf(s.agents),
    entities: entitiesOf(s.entities),
    notable: notableOf(s.notable),
    intent: intentOf(s.intent),
    events: eventsOf(waitText),
    cursor: str(s.cursor) ?? str(w.cursor),
  };
}

/** Calls status, then wait for one second from the given cursor, and normalises both replies. */
export async function observe(world: WorldCalls, cursor: string | null): Promise<Observation> {
  const statusText = await world.call('status', {});
  const args: Record<string, unknown> = { max_seconds: 1 };
  if (cursor !== null) args.cursor = cursor;
  const waitText = await world.call('wait', args);
  return parseObservation(statusText, waitText);
}
