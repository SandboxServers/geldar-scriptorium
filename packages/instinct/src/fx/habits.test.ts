import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { actIntent } from '../contract.ts';
import type { EventLine, Observation } from '../observe.ts';
import { runInstinct } from '../run.ts';
import { emptyState, type InstinctState, loadState, saveState } from '../state.ts';
import type { WorldLink } from '../world.ts';
import { GOALS_MAX, learnHabits, submittedFrom } from './habits.ts';
import { idleFx } from './idle.ts';

const GOAL = 'find food';
const FINISHED: EventLine = { kind: 'intent_finished', text: 'Your intent finished.' };
const WORLD_ENV = { GELDAR_MCP_URL: 'http://proxy-player:8080/p/life1' };
const ACCEPTED = JSON.stringify({ accepted: [{ id: 'a1' }], rejected: [] });

/** The standard sheet: every score 3, so the miner weight is 1. */
const STANDARD_SHEET = JSON.stringify({
  version: 1,
  attributes: { curiosity: 3, common_sense: 3, cleverness: 3, aggression: 3 },
  alignment: { law: 3, good: 3 },
  op_modes: { explorer: 3, farmer: 3, miner: 3, builder: 3, crafter: 3, warrior: 3, nitwit: 3 },
});

function obsWith(events: EventLine[] = []): Observation {
  return {
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
    events,
    cursor: null,
  };
}

/**
 * The instinct step submitted one intent for a goal and the world shows it running. The plan's arguments are the
 * status only (observe.ts planOf), so last_intent never holds the real arguments; the submitted record does.
 */
function submit(state: InstinctState, program: string, args: Record<string, unknown>, goal = GOAL) {
  state.last_intent = { goal, program, arguments: { status: 'running' } };
  state.submitted = { goal, program, arguments: args };
}

/** A state after one submitted intent, as the previous waking left it. */
function lastRun(program: string, args: Record<string, unknown>, goal = GOAL): InstinctState {
  const state = emptyState();
  submit(state, program, args, goal);
  return state;
}

/** One waking that saw the plain finished line for the state's last intent. */
function finishOnce(state: InstinctState, goal: string | null = GOAL): void {
  learnHabits(state, obsWith([FINISHED]), goal);
}

/** A fresh instinct directory under a volume root, as the supervisor lays it out. */
function volume(): { stateDir: string; workspace: string } {
  const root = mkdtempSync(join(tmpdir(), 'instinct-habits-'));
  const stateDir = join(root, 'instinct');
  mkdirSync(stateDir, { recursive: true });
  const workspace = join(root, 'ws');
  mkdirSync(join(workspace, 'memory'), { recursive: true });
  writeFileSync(join(workspace, 'memory', 'goals.md'), `- ${GOAL}\n`);
  writeFileSync(join(stateDir, 'sheet.json'), STANDARD_SHEET);
  return { stateDir, workspace };
}

describe('learnHabits', () => {
  it('a finished submitted intent is remembered once and counted on repeat', () => {
    const state = lastRun('gather', { item: 'wood' });
    finishOnce(state);
    expect(state.habits[GOAL]).toEqual([{ program: 'gather', arguments: { item: 'wood' }, n: 1 }]);
    submit(state, 'gather', { item: 'wood' });
    finishOnce(state);
    expect(state.habits[GOAL]).toEqual([{ program: 'gather', arguments: { item: 'wood' }, n: 2 }]);
  });

  it('the stored arguments are the submitted ones, never the running plan status', () => {
    const state = lastRun('gather', { item: 'wood', n: 4 });
    finishOnce(state);
    expect(state.habits[GOAL]?.[0]?.arguments).toEqual({ item: 'wood', n: 4 });
    expect(state.habits[GOAL]?.[0]?.arguments).not.toEqual({ status: 'running' });
  });

  it('the same arguments in another key order are one habit', () => {
    const state = lastRun('craft', { a: 1, b: { x: 1, y: 2 } });
    finishOnce(state);
    submit(state, 'craft', { b: { y: 2, x: 1 }, a: 1 });
    finishOnce(state);
    expect(state.habits[GOAL]).toHaveLength(1);
    expect(state.habits[GOAL]?.[0]?.n).toBe(2);
  });

  it('an intent the agent started itself is never stored', () => {
    const state = emptyState();
    state.last_intent = { goal: GOAL, program: 'gather', arguments: { status: 'running' } };
    finishOnce(state);
    expect(state.habits).toEqual({});
  });

  it('a submitted record for another program does not match the finished intent', () => {
    const state = lastRun('craft', { a: 1 });
    state.last_intent = { goal: GOAL, program: 'gather', arguments: { status: 'running' } };
    finishOnce(state);
    expect(state.habits).toEqual({});
    expect(state.submitted).toBeNull();
  });

  it('a reworded goal is not matched', () => {
    const state = lastRun('gather', { item: 'wood' }, 'Find food');
    finishOnce(state, GOAL);
    expect(state.habits).toEqual({});
    finishOnce(lastRun('gather', {}, GOAL), null);
    expect(state.habits).toEqual({});
  });

  it('flee is never stored, nor an unknown program', () => {
    const state = lastRun('flee', {});
    finishOnce(state);
    submit(state, 'dance', {});
    finishOnce(state);
    expect(state.habits).toEqual({});
  });

  it('bounds: 5 per goal (the lowest n drops), 50 goals (the least recently used drops)', () => {
    const state = emptyState();
    // Three repeats of one means, then six other means once each: the repeated one has the top n and stays.
    for (let i = 0; i < 3; i++) {
      submit(state, 'gather', { i: 0 });
      finishOnce(state);
    }
    for (let i = 1; i <= 6; i++) {
      submit(state, 'gather', { i });
      finishOnce(state);
    }
    const kept = state.habits[GOAL] ?? [];
    expect(kept).toHaveLength(5);
    expect(kept[0]).toEqual({ program: 'gather', arguments: { i: 0 }, n: 3 });

    // Fifty goals, then the first one is used again (it becomes the most recent), then a fifty-first goal.
    const many = emptyState();
    for (let g = 0; g < GOALS_MAX; g++) {
      submit(many, 'gather', {}, `goal ${g}`);
      finishOnce(many, `goal ${g}`);
    }
    submit(many, 'gather', {}, 'goal 0');
    finishOnce(many, 'goal 0');
    submit(many, 'gather', {}, 'goal new');
    finishOnce(many, 'goal new');
    const goals = Object.keys(many.habits);
    expect(goals).toHaveLength(GOALS_MAX);
    expect(goals).toContain('goal 0');
    expect(goals).toContain('goal new');
    expect(goals).not.toContain('goal 1');
  });

  it('an intent that ended in failure is not remembered, and its record ends', () => {
    const state = lastRun('gather', { item: 'wood' });
    const failed: EventLine = { kind: 'intent_failed', text: 'Your intent failed: no path.' };
    learnHabits(state, obsWith([failed]), GOAL);
    expect(state.habits).toEqual({});
    expect(state.submitted).toBeNull();
    submit(state, 'gather', { item: 'wood' });
    learnHabits(state, obsWith([FINISHED, failed]), GOAL);
    expect(state.habits).toEqual({});
  });

  it('a finished intent ends its submitted record, learned or not', () => {
    const state = lastRun('gather', { item: 'wood' });
    finishOnce(state, null);
    expect(state.submitted).toBeNull();
  });

  it('habits survive a restart (state saved and reloaded)', () => {
    const state = lastRun('gather', { item: 'wood' });
    finishOnce(state);
    const dir = mkdtempSync(join(tmpdir(), 'instinct-habits-state-'));
    saveState(dir, state);
    expect(loadState(dir).habits[GOAL]).toEqual([
      { program: 'gather', arguments: { item: 'wood' }, n: 1 },
    ]);
  });
});

describe('submittedFrom', () => {
  it('reads the goal, program and arguments of an intent act', () => {
    expect(submittedFrom(actIntent(GOAL, 'gather', { item: 'wood' }))).toEqual({
      goal: GOAL,
      program: 'gather',
      arguments: { item: 'wood' },
    });
  });

  it('an act with no goal gives null', () => {
    expect(submittedFrom({ tool: 'act', arguments: { program: 'walk' } })).toBeNull();
  });
});

describe('habits end to end with idle', () => {
  it('a remembered program is picked, its submitted arguments are replayed, and the finished run is counted', async () => {
    const { stateDir, workspace } = volume();
    saveState(stateDir, {
      ...emptyState(),
      habits: { [GOAL]: [{ program: 'gather', arguments: { item: 'wood' }, n: 1 }] },
    });
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    // Waking 1: no plan, the act is sent. Waking 2: the plan runs. Waking 3: the plan has finished (the plain line).
    const waits = [
      '{}',
      JSON.stringify({
        snapshot: { current_plan: { goal: GOAL, action: 'gather', status: 'running' } },
      }),
      JSON.stringify({ events: [{ type: 'intent_finished', text: 'Your intent finished.' }] }),
    ];
    const link: WorldLink = {
      async call(name, args) {
        calls.push({ name, args });
        if (name === 'act') return ACCEPTED;
        return waits.shift() ?? '{}';
      },
      async close() {},
    };
    const env = {
      GELDAR_INSTINCT_STATE: stateDir,
      GELDAR_INSTINCT_WORKSPACE: workspace,
      GELDAR_INSTINCT_THINK_P: '0',
      ...WORLD_ENV,
    };
    const connect = async () => link;
    const first = await runInstinct(env, 1, new Date(), connect, [idleFx]);
    expect(first).toMatchObject({ kind: 'settle', fx: 'idle' });
    const act = calls.find((c) => c.name === 'act');
    expect(JSON.stringify(act?.args)).toContain('gather');
    expect(JSON.stringify(act?.args)).toContain('"item":"wood"');
    await runInstinct(env, 2, new Date(), connect, [idleFx]);
    await runInstinct(env, 3, new Date(), connect, [idleFx]);
    expect(loadState(stateDir).habits[GOAL]).toEqual([
      { program: 'gather', arguments: { item: 'wood' }, n: 2 },
    ]);
  });
});
