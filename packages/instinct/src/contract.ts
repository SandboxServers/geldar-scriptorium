// The instinct step's result protocol (shared contract, docs/analysis/harness/work-packets-kit-b.md). This file is
// pure: it imports nothing, so the supervisor and the tests can read it without the world or the engine.

export const INSTINCT_V = 1;
export const MAX_RESULT_BYTES = 65536;
export const MAX_FACTS = 4;
export const MAX_FACT_CHARS = 200;

export const FX_NAMES = ['failure', 'novelty', 'idle', 'guard', 'none'] as const;
export type FxName = (typeof FX_NAMES)[number];

export const PASS_REASONS = [
  'off',
  'no_sheet',
  'sheet_invalid',
  'no_world',
  'send_failed',
  'dead',
  'speech_addressed',
  'first_sighting',
  'failure_past_cap',
  'insight',
  'no_variation',
  'no_adopted_goal',
  'no_candidate',
  'think_draw',
  'max_picks',
  'nothing_to_do',
  'error',
] as const;
export type PassReason = (typeof PASS_REASONS)[number];

/** Reasons that override the think draw and always reach the model. */
export const FORCED: readonly PassReason[] = [
  'speech_addressed',
  'first_sighting',
  'failure_past_cap',
];

/** One d20 check or one seeded draw. `mode: 'off'` means no d20 (rolls off, or a weighted or think draw). */
export interface RollRecord {
  id: string;
  fx: string;
  score: number;
  dc: number;
  mode: 'dis' | 'flat' | 'adv' | 'off';
  dice: number[];
  kept: number | null;
  bonus: number;
  total: number | null;
  success: boolean;
}

/** The act the world is asked to run: the act tool takes intent, actions or say (mcp-play.schema.json ActInput). */
export interface ActRecord {
  tool: 'act';
  arguments: Record<string, unknown>;
}

/**
 * The act for one durable intent. An intent must carry wake_on and limits (thought.schema.json Intent). The act tool
 * has no source argument (ActInput is additionalProperties false), so the source tag stays in the audit line only.
 */
export function actIntent(goal: string, program: string, args: Record<string, unknown>): ActRecord {
  return {
    tool: 'act',
    arguments: {
      intent: {
        goal,
        program,
        arguments: args,
        wake_on: ['goal_completed'],
        limits: { max_world_ticks: 2400, max_block_operations: 64 },
      },
    },
  };
}

export type InstinctResult =
  | {
      v: 1;
      kind: 'settle';
      fx: FxName;
      why: string;
      act: ActRecord;
      rolls: RollRecord[];
      world: { accepted: true; line: string };
    }
  | { v: 1; kind: 'pass-with-facts'; fx: FxName; facts: string[]; rolls: RollRecord[] }
  | { v: 1; kind: 'pass'; reason: PassReason; forced: boolean; rolls: RollRecord[] };

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Obj, keys: readonly string[]): boolean {
  const have = Object.keys(value).sort();
  const want = [...keys].sort();
  return have.length === want.length && have.every((k, i) => k === want[i]);
}

/** Printable ASCII, at most `max` characters: the only text a fact, a why or a world.line may hold. */
function isPrintable(value: unknown, max = MAX_FACT_CHARS): value is string {
  return typeof value === 'string' && value.length <= max && /^[\x20-\x7e]*$/.test(value);
}

function isFact(value: unknown): value is string {
  return isPrintable(value);
}

function isRoll(value: unknown): value is RollRecord {
  if (!isObj(value)) return false;
  if (
    !exactKeys(value, [
      'id',
      'fx',
      'score',
      'dc',
      'mode',
      'dice',
      'kept',
      'bonus',
      'total',
      'success',
    ])
  ) {
    return false;
  }
  const nums = (xs: unknown): boolean =>
    Array.isArray(xs) && xs.every((x) => typeof x === 'number');
  return (
    typeof value.id === 'string' &&
    typeof value.fx === 'string' &&
    Number.isInteger(value.score) &&
    Number.isInteger(value.dc) &&
    ['dis', 'flat', 'adv', 'off'].includes(String(value.mode)) &&
    nums(value.dice) &&
    (value.kept === null || typeof value.kept === 'number') &&
    typeof value.bonus === 'number' &&
    (value.total === null || typeof value.total === 'number') &&
    typeof value.success === 'boolean'
  );
}

function rollsOk(value: unknown): value is RollRecord[] {
  return Array.isArray(value) && value.every(isRoll);
}

function parseSettle(value: Obj): InstinctResult | null {
  if (!exactKeys(value, ['v', 'kind', 'fx', 'why', 'act', 'rolls', 'world'])) return null;
  const { act, world } = value;
  if (!isObj(act) || !exactKeys(act, ['tool', 'arguments']) || act.tool !== 'act') return null;
  if (!isObj(act.arguments) || !isObj(world) || !exactKeys(world, ['accepted', 'line']))
    return null;
  if (world.accepted !== true || !isPrintable(world.line)) return null;
  if (!(FX_NAMES as readonly unknown[]).includes(value.fx) || !isPrintable(value.why)) return null;
  if (!rollsOk(value.rolls)) return null;
  return {
    v: 1,
    kind: 'settle',
    fx: value.fx as FxName,
    why: value.why,
    act: { tool: 'act', arguments: act.arguments },
    rolls: value.rolls,
    world: { accepted: true, line: world.line },
  };
}

function parsePassWithFacts(value: Obj): InstinctResult | null {
  if (!exactKeys(value, ['v', 'kind', 'fx', 'facts', 'rolls'])) return null;
  if (!(FX_NAMES as readonly unknown[]).includes(value.fx) || !rollsOk(value.rolls)) return null;
  if (!Array.isArray(value.facts) || value.facts.length > MAX_FACTS || !value.facts.every(isFact))
    return null;
  return {
    v: 1,
    kind: 'pass-with-facts',
    fx: value.fx as FxName,
    facts: value.facts,
    rolls: value.rolls,
  };
}

function parsePass(value: Obj): InstinctResult | null {
  if (!exactKeys(value, ['v', 'kind', 'reason', 'forced', 'rolls'])) return null;
  const reason = value.reason as PassReason;
  if (!(PASS_REASONS as readonly unknown[]).includes(reason) || typeof value.forced !== 'boolean')
    return null;
  if (value.forced !== FORCED.includes(reason) || !rollsOk(value.rolls)) return null;
  return { v: 1, kind: 'pass', reason, forced: value.forced, rolls: value.rolls };
}

/** Strict parse of one result line. Anything unexpected is null: a settle needs world.accepted === true. */
export function parseInstinctResult(text: string): InstinctResult | null {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_RESULT_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(value) || value.v !== INSTINCT_V) return null;
  if (value.kind === 'settle') return parseSettle(value);
  if (value.kind === 'pass-with-facts') return parsePassWithFacts(value);
  if (value.kind === 'pass') return parsePass(value);
  return null;
}

/** Printable ASCII only, double quotes become single quotes, at most `max` characters. */
export function sanitizeFact(text: string, max: number): string {
  const clean = String(text)
    .replace(/"/g, "'")
    .replace(/[^\x20-\x7e]/g, '');
  return clean.slice(0, Math.max(0, max));
}
