import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rngFor, type Sheet } from '@geldar/scriptorium-psyche';
import { describe, expect, it } from 'vitest';
import type { FxContext, InstinctConfig } from '../decide.ts';
import type { Observation } from '../observe.ts';
import { emptyState, type InstinctState } from '../state.ts';
import { readAdoptedGoal } from './goal.ts';
import { type Candidate, candidatesFor, idleFx, modeOf, weightOf } from './idle.ts';

const SHEET: Sheet = {
  version: 1,
  attributes: { curiosity: 3, common_sense: 3, cleverness: 3, aggression: 3 },
  alignment: { law: 3, good: 3 },
  op_modes: { explorer: 3, farmer: 3, miner: 3, builder: 3, crafter: 3, warrior: 3, nitwit: 3 },
};
const GOAL = 'find food';
const HABITS = {
  [GOAL]: [
    { program: 'travel', arguments: { to: 'river' }, n: 2 },
    { program: 'gather', arguments: { item: 'wood' }, n: 1 },
  ],
};

interface Setup {
  goal?: string | null;
  state?: Partial<InstinctState>;
  sheet?: Sheet;
  thinkP?: number;
  maxPicks?: number;
  tick?: number;
  draw?: (fx: string) => number;
}

/** A context with the real seeded draw (as run.ts builds it) unless a draw is given. */
function ctxOf(obs: Partial<Observation> = {}, setup: Setup = {}): FxContext {
  const rolls: FxContext['rolls'] = [];
  const tick = setup.tick ?? 5;
  const lifeKey = 'life-idle-test';
  const cfg: InstinctConfig = {
    arm: 'instinct',
    failureCap: 4,
    maxPicks: setup.maxPicks ?? 3,
    thinkP: setup.thinkP ?? 0,
    rolls: true,
  };
  const full: Observation = {
    tick: null,
    dead: false,
    night: false,
    position: null,
    health: 20,
    hunger: 20,
    inventory: {},
    foodCarried: true,
    inventoryFull: null,
    agents: [],
    entities: [],
    notable: [],
    intent: null,
    events: [],
    cursor: null,
    ...obs,
  };
  const state: InstinctState = { ...emptyState(), habits: { ...HABITS }, ...setup.state };
  return {
    obs: full,
    sheet: setup.sheet ?? SHEET,
    state,
    cfg,
    lifeKey,
    tick,
    goal: setup.goal === undefined ? GOAL : setup.goal,
    knownText: '',
    check() {
      throw new Error('the idle fx makes no check');
    },
    draw(fx: string) {
      if (setup.draw) {
        const value = setup.draw(fx);
        rolls.push({
          id: fx,
          fx,
          score: 0,
          dc: 0,
          mode: 'off',
          dice: [],
          kept: null,
          bonus: 0,
          total: value,
          success: false,
        });
        return value;
      }
      const n = rolls.length;
      const value = rngFor({
        lifeId: lifeKey,
        producer: 'kit',
        generation: 0,
        tick,
        fx,
        decisionSeq: n,
      }).next();
      rolls.push({
        id: `${lifeKey}:${tick}:${fx}:${n}`,
        fx,
        score: 0,
        dc: 0,
        mode: 'off',
        dice: [],
        kept: null,
        bonus: 0,
        total: value,
        success: false,
      });
      return value;
    },
    rolls,
  };
}

function candidate(program: string, mode: Candidate['mode']): Candidate {
  return { program, arguments: {}, mode };
}

describe('idle fx: the adopted goal gate', () => {
  it('no adopted goal: escalate no_adopted_goal, never an act', () => {
    const result = idleFx(ctxOf({}, { goal: null }));
    expect(result).toEqual({ kind: 'escalate', fx: 'idle', reason: 'no_adopted_goal' });
  });

  it('a running intent gives pass; speech to me gives pass', () => {
    const intent = { goal: GOAL, program: 'travel', arguments: { status: 'running' } };
    expect(idleFx(ctxOf({ intent }))).toEqual({ kind: 'pass' });
    const events = [{ kind: 'speech_to_me' as const, text: 'hi' }];
    expect(idleFx(ctxOf({ events }))).toEqual({ kind: 'pass' });
  });

  it('after maxPicks the fx escalates max_picks, and the think draw is not reached', () => {
    const result = idleFx(ctxOf({}, { maxPicks: 2, state: { picks_in_a_row: 2 } }));
    expect(result).toEqual({ kind: 'escalate', fx: 'idle', reason: 'max_picks' });
  });

  it('a think draw below thinkP escalates think_draw; the draw is in rolls with mode off', () => {
    const ctx = ctxOf({}, { thinkP: 0.25, draw: () => 0.1 });
    expect(idleFx(ctx)).toEqual({ kind: 'escalate', fx: 'idle', reason: 'think_draw' });
    expect(ctx.rolls).toEqual([expect.objectContaining({ fx: 'idle_think', mode: 'off' })]);
  });
});

describe('idle fx: candidates and weights', () => {
  it('flee and unknown programs are never candidates', () => {
    expect(modeOf('flee')).toBeNull();
    expect(modeOf('unknown')).toBeNull();
    expect(modeOf('constructor')).toBeNull();
    const state = emptyState();
    state.habits[GOAL] = [
      { program: 'flee', arguments: {}, n: 1 },
      { program: 'unknown', arguments: {}, n: 1 },
    ];
    expect(candidatesFor(GOAL, state)).toEqual([]);
    expect(candidatesFor('constructor', state)).toEqual([]);
  });

  it('weights 0.25 0.5 1 2 4 by op mode score', () => {
    const weights = ([1, 2, 3, 4, 5] as const).map((score) =>
      weightOf(
        candidate('travel', 'explorer'),
        ctxOf({}, { sheet: { ...SHEET, op_modes: { ...SHEET.op_modes, explorer: score } } }),
      ),
    );
    expect(weights).toEqual([0.25, 0.5, 1, 2, 4]);
  });

  it('night, hunger and full-inventory multipliers', () => {
    const table: [Partial<Observation>, Candidate['mode'], number][] = [
      [{ night: true }, 'builder', 4],
      [{ night: true }, 'nitwit', 4],
      [{ night: true }, 'miner', 0.25],
      [{ night: false }, 'miner', 1],
      [{ hunger: 6, foodCarried: false }, 'miner', 4],
      [{ hunger: 7, foodCarried: false }, 'miner', 1],
      [{ hunger: 6, foodCarried: true }, 'miner', 1],
      [{ inventoryFull: true }, 'miner', 0],
      [{ inventoryFull: true }, 'builder', 1],
    ];
    for (const [patch, mode, expected] of table) {
      expect(weightOf(candidate('x', mode), ctxOf(patch))).toBe(expected);
    }
  });

  it('a null field applies nothing', () => {
    const miner = candidate('gather', 'miner');
    expect(weightOf(miner, ctxOf({ hunger: 5, foodCarried: null }))).toBe(1);
    expect(weightOf(miner, ctxOf({ night: null, inventoryFull: null }))).toBe(1);
    expect(weightOf(candidate('build', 'builder'), ctxOf({ night: null }))).toBe(1);
  });

  it('no candidates for the goal: escalate no_candidate', () => {
    expect(idleFx(ctxOf({}, { state: { habits: {} } }))).toEqual({
      kind: 'escalate',
      fx: 'idle',
      reason: 'no_candidate',
    });
  });
});

describe('idle fx: the pick', () => {
  it('the act has wake_on, limits and the recorded arguments only', () => {
    const result = idleFx(ctxOf({}, { draw: () => 0.99 }));
    expect(result).toMatchObject({ kind: 'act', fx: 'idle', act: { tool: 'act' } });
    if (result.kind !== 'act') throw new Error('expected an act');
    const intent = (result.act.arguments as { intent: Record<string, unknown> }).intent;
    expect(intent).toEqual({
      goal: GOAL,
      program: 'travel',
      arguments: { to: 'river' },
      wake_on: ['goal_completed'],
      limits: { max_world_ticks: 2400, max_block_operations: 64 },
    });
  });

  it('same state and tick give the same pick; a different tick can differ', () => {
    const pick = (tick: number) => {
      const result = idleFx(ctxOf({}, { tick }));
      if (result.kind !== 'act') throw new Error('expected an act');
      return (result.act.arguments as { intent: { program: string } }).intent.program;
    };
    expect(pick(5)).toBe(pick(5));
    const seen = new Set<string>();
    for (let tick = 1; tick <= 40; tick++) seen.add(pick(tick));
    expect(seen.size).toBe(2);
  });

  it('the pick follows the cumulative weights: a low draw picks the first, a high draw the last', () => {
    const first = idleFx(ctxOf({}, { draw: (fx) => (fx === 'idle_pick' ? 0.01 : 0) }));
    const last = idleFx(ctxOf({}, { draw: (fx) => (fx === 'idle_pick' ? 0.99 : 0) }));
    expect(first).toMatchObject({
      kind: 'act',
      act: { arguments: { intent: { program: 'gather' } } },
    });
    expect(last).toMatchObject({
      kind: 'act',
      act: { arguments: { intent: { program: 'travel' } } },
    });
  });

  it('the goal file is unchanged, and the goal text is in no why and no fact', () => {
    const sentinel = 'SENTINEL-GOAL-7f3a';
    const root = mkdtempSync(join(tmpdir(), 'instinct-idle-'));
    mkdirSync(join(root, 'memory'));
    const file = join(root, 'memory', 'goals.md');
    writeFileSync(file, `# Goals\n- ${sentinel}\n`);
    const before = createHash('sha256').update(readFileSync(file)).digest('hex');
    const goal = readAdoptedGoal(root);
    const result = idleFx(ctxOf({}, { goal, state: { habits: { [sentinel]: HABITS[GOAL] } } }));
    expect(goal).toBe(sentinel);
    if (result.kind !== 'act') throw new Error('expected an act');
    // The goal is the act's own intent goal (the world's field); the why line and facts never carry it.
    expect(result.why).not.toContain(sentinel);
    const after = createHash('sha256').update(readFileSync(file)).digest('hex');
    expect(after).toBe(before);
  });
});
