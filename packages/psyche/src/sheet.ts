// The kit's own strict reader of the brief 3.2 sheet. It reads the kit's copy of the schema; the world's copy
// (geldar) is canonical. A sheet carries no proficiency: XP lives in the proficiency state, so a text that
// carries that key is refused, the same as the engine's normalizer refuses it.
import type { Score } from '../engine/index.ts';

export type Sheet = {
  version: 1;
  attributes: { curiosity: Score; common_sense: Score; cleverness: Score; aggression: Score };
  alignment: { law: Score; good: Score };
  op_modes: {
    explorer: Score;
    farmer: Score;
    miner: Score;
    builder: Score;
    crafter: Score;
    warrior: Score;
    nitwit: Score;
  };
};

/** The largest sheet text the reader reads, in UTF-8 bytes. Larger text is refused before it is parsed. */
export const MAX_SHEET_BYTES = 4096;

const TOP_KEYS = ['version', 'attributes', 'alignment', 'op_modes'] as const;
const ATTRIBUTE_KEYS = ['curiosity', 'common_sense', 'cleverness', 'aggression'] as const;
const ALIGNMENT_KEYS = ['law', 'good'] as const;
const OP_MODE_KEYS = [
  'explorer',
  'farmer',
  'miner',
  'builder',
  'crafter',
  'warrior',
  'nitwit',
] as const;

type Plain = Record<string, unknown>;

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when every own key of the object is one of the allowed keys. */
function hasOnlyKeys(record: Plain, keys: readonly string[]): boolean {
  return Object.keys(record).every((key) => keys.includes(key));
}

function readScore(value: unknown): Score | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 1 || value > 5) return null;
  return value as Score;
}

/** One group: no unknown key, every named key present as an integer 1 to 5. Null on any fault. */
function readGroup<K extends string>(value: unknown, keys: readonly K[]): Record<K, Score> | null {
  if (!isPlain(value) || !hasOnlyKeys(value, keys)) return null;
  const out = {} as Record<K, Score>;
  for (const key of keys) {
    const score = readScore(value[key]);
    if (score === null) return null;
    out[key] = score;
  }
  return out;
}

function readSheet(input: unknown): Sheet | null {
  if (!isPlain(input) || !hasOnlyKeys(input, TOP_KEYS)) return null;
  if (input.version !== 1) return null;
  const attributes = readGroup(input.attributes, ATTRIBUTE_KEYS);
  const alignment = readGroup(input.alignment, ALIGNMENT_KEYS);
  const opModes = readGroup(input.op_modes, OP_MODE_KEYS);
  if (attributes === null || alignment === null || opModes === null) return null;
  return { version: 1, attributes, alignment, op_modes: opModes };
}

/**
 * The sheet in the text, or null. Null for text over MAX_SHEET_BYTES, text that is not JSON, any key outside
 * the schema at any level, a missing key, a score that is not an integer 1 to 5, or a version other than 1.
 * Never throws and never returns a partial sheet.
 */
export function parseSheet(text: string): Sheet | null {
  try {
    if (typeof text !== 'string') return null;
    if (new TextEncoder().encode(text).byteLength > MAX_SHEET_BYTES) return null;
    return readSheet(JSON.parse(text));
  } catch {
    return null;
  }
}
