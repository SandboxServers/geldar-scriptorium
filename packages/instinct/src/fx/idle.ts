// The idle choice: with no plan running and an adopted goal, pick one known means (a habit recorded for that goal) by a
// weighted draw. The weight follows the sheet's operating mode score and the world's night, hunger and pack. Only the
// fields this fx reads are the ones Observation gives: no recipes, no seen blocks, no tick, no arguments of a plan.
import { actIntent } from '../contract.ts';
import type { Fx, FxContext } from '../decide.ts';
import type { InstinctState } from '../state.ts';

export interface Candidate {
  program: string;
  arguments: Record<string, unknown>;
  mode: 'explorer' | 'miner' | 'crafter' | 'builder' | 'warrior' | 'nitwit';
}

/** The program name to operating mode. Flee and any other program are not here, so they are never candidates. */
const MODES: ReadonlyMap<string, Candidate['mode']> = new Map([
  ['travel', 'explorer'],
  ['gather', 'miner'],
  ['craft', 'crafter'],
  ['build', 'builder'],
  ['follow', 'warrior'],
  ['rest', 'nitwit'],
]);

/** The operating mode of a program, or null when the kit does not offer it as a means. */
export function modeOf(program: string): Candidate['mode'] | null {
  return MODES.get(program) ?? null;
}

/** The known means recorded for a goal (state.habits), those with a mode only. */
export function candidatesFor(goal: string, state: InstinctState): Candidate[] {
  // Own-property lookup: a goal named like an Object prototype key must not reach the prototype.
  const habits = Object.hasOwn(state.habits, goal) ? state.habits[goal] : undefined;
  const out: Candidate[] = [];
  for (const habit of Array.isArray(habits) ? habits : []) {
    const mode = modeOf(habit.program);
    if (mode !== null) out.push({ program: habit.program, arguments: habit.arguments, mode });
  }
  return out;
}

/**
 * The weight of one candidate: 2 to the power of (its mode score minus 3), so 0.25 to 4. A night multiplies builder
 * and nitwit by 4 and the others by 0.25; no food carried and hunger at most 6 multiplies miner by 4; a full pack
 * multiplies miner by 0. A null field applies nothing.
 */
export function weightOf(c: Candidate, ctx: FxContext): number {
  const { obs } = ctx;
  let weight = 2 ** (ctx.sheet.op_modes[c.mode] - 3);
  if (obs.night === true) weight *= c.mode === 'builder' || c.mode === 'nitwit' ? 4 : 0.25;
  if (obs.hunger !== null && obs.hunger <= 6 && obs.foodCarried === false && c.mode === 'miner') {
    weight *= 4;
  }
  if (obs.inventoryFull === true && c.mode === 'miner') weight *= 0;
  return weight;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The idle fx. Pass while a plan runs or someone speaks to me; escalate otherwise unless a candidate is picked. */
export const idleFx: Fx = (ctx: FxContext) => {
  const { obs, state, cfg } = ctx;
  if (obs.intent !== null || obs.events.some((e) => e.kind === 'speech_to_me'))
    return { kind: 'pass' };
  const goal = ctx.goal;
  if (goal === null) return { kind: 'escalate', fx: 'idle', reason: 'no_adopted_goal' };
  if (state.picks_in_a_row >= cfg.maxPicks) {
    return { kind: 'escalate', fx: 'idle', reason: 'max_picks' };
  }
  if (ctx.draw('idle_think') < cfg.thinkP)
    return { kind: 'escalate', fx: 'idle', reason: 'think_draw' };

  const weighted = candidatesFor(goal, state)
    .map((c) => ({ c, weight: weightOf(c, ctx) }))
    .filter((x) => x.weight > 0)
    .sort(
      (a, b) =>
        compareText(a.c.program, b.c.program) ||
        compareText(JSON.stringify(a.c.arguments), JSON.stringify(b.c.arguments)),
    );
  const total = weighted.reduce((sum, x) => sum + x.weight, 0);
  if (weighted.length === 0 || total <= 0) {
    return { kind: 'escalate', fx: 'idle', reason: 'no_candidate' };
  }

  // One draw over the cumulative normalised weights, in the sorted order.
  const u = ctx.draw('idle_pick') * total;
  let acc = 0;
  let chosen = weighted[weighted.length - 1];
  for (const item of weighted) {
    acc += item.weight;
    if (u < acc) {
      chosen = item;
      break;
    }
  }
  if (chosen === undefined) return { kind: 'escalate', fx: 'idle', reason: 'no_candidate' };
  return {
    kind: 'act',
    fx: 'idle',
    why: 'a means that worked for the top goal',
    act: actIntent(goal, chosen.c.program, chosen.c.arguments),
  };
};
