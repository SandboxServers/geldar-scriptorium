// The prompt facts: the only channel from the instinct step to the model. A closed set of templates; each takes only
// world-derived words and every output goes through sanitizeFact. A slot that does not fit gives null.
import { MAX_FACT_CHARS, sanitizeFact } from './contract.ts';

export type FactKey = 'repeat_failure' | 'new_sighting' | 'own_act';

const NAME = /^[A-Za-z0-9 _'-]{1,40}$/;
const OWN_ACT_CHARS = 120;

export function makeFact(key: FactKey, slots: Record<string, string | number>): string | null {
  if (key === 'repeat_failure') {
    const n = slots.n;
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) return null;
    return sanitizeFact(`You have tried this ${n} times and it has not worked.`, MAX_FACT_CHARS);
  }
  if (key === 'new_sighting') {
    const name = slots.name;
    if (typeof name !== 'string' || !NAME.test(name)) return null;
    return sanitizeFact(`You have not seen ${name} before.`, MAX_FACT_CHARS);
  }
  const line = slots.line;
  if (typeof line !== 'string') return null;
  return sanitizeFact(
    `You did this a moment ago: ${sanitizeFact(line, OWN_ACT_CHARS)}`,
    MAX_FACT_CHARS,
  );
}
