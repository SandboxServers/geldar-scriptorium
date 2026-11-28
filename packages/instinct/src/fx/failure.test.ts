import {
  type RollRecord as PsycheRoll,
  parseSheet,
  rngFor,
  check as rollCheck,
  type Score,
  type Sheet,
} from '@geldar/scriptorium-psyche';
import { describe, expect, it } from 'vitest';
import { decide, type Fx, type FxContext } from '../decide.ts';
import type { EventLine, Observation } from '../observe.ts';
import { emptyState, type InstinctState } from '../state.ts';
import { failureFx, PROFICIENCY_DEGRADED, problemKey, retryCap } from './failure.ts';

const LAST = { goal: 'find food', program: 'mine', arguments: { status: 'failed' } };
const KEY = problemKey(LAST.goal, LAST.program);
const FAILED: EventLine = { kind: 'intent_failed', text: 'Your intent failed: no path' };
const FINISHED: EventLine = { kind: 'intent_finished', text: 'Your intent finished.' };

const noObs: Observation = {
  tick: 1,
  dead: false,
  night: null,
  position: null,
  health: null,
  hunger: null,
  inventory: {},
  foodCarried: null,
  inventoryFull: null,
  agents: [],
  entities: [],
  notable: [],
  intent: null,
  events: [],
  cursor: null,
};

interface Setup {
  events?: EventLine[];
  state?: InstinctState;
  cleverness?: number;
  failureCap?: number;
  /** Forces the outcome of every insight check; unset means the real psyche check with rolls off. */
  success?: boolean;
}

interface CheckCall {
  fx: string;
  score: Score;
  dc: number;
  prof: number;
}

/** A state whose last intent is LAST, with attempts seeded for KEY when given. */
function stateWith(attempts = 0, last: InstinctState['last_intent'] = LAST): InstinctState {
  const state = emptyState();
  state.last_intent = last;
  if (attempts > 0) state.attempts[KEY] = attempts;
  return state;
}

function sheetWith(cleverness: number): Sheet {
  const sheet = parseSheet(
    JSON.stringify({
      version: 1,
      attributes: { curiosity: 3, common_sense: 3, cleverness, aggression: 3 },
      alignment: { law: 3, good: 3 },
      op_modes: { explorer: 3, farmer: 3, miner: 3, builder: 3, crafter: 3, warrior: 3, nitwit: 3 },
    }),
  );
  if (sheet === null) throw new Error('test sheet is invalid');
  return sheet;
}

/** A context whose checks go through the real psyche check (rolls off), and record each call and roll. */
function ctxFor(setup: Setup = {}): { ctx: FxContext; calls: CheckCall[]; rolls: PsycheRoll[] } {
  const calls: CheckCall[] = [];
  const rolls: PsycheRoll[] = [];
  const ctx: FxContext = {
    obs: { ...noObs, events: setup.events ?? [FAILED] },
    sheet: sheetWith(setup.cleverness ?? 3),
    state: setup.state ?? stateWith(),
    cfg: {
      arm: 'instinct',
      failureCap: setup.failureCap ?? 4,
      maxPicks: 3,
      thinkP: 0.25,
      rolls: false,
    },
    lifeKey: 'life',
    tick: 1,
    goal: null,
    knownText: '',
    check(fx, score, dc, prof = 0) {
      calls.push({ fx, score, dc, prof });
      const n = rolls.length;
      const rng = rngFor({
        lifeId: 'life',
        producer: 'kit',
        generation: 0,
        tick: 1,
        fx,
        decisionSeq: n,
      });
      const out = rollCheck(fx, score, dc, rng, n, 'life', 1, { prof, rolls: false });
      const success = setup.success ?? out.success;
      const roll = { ...out.roll, success };
      rolls.push(roll);
      return { success, roll };
    },
    draw: () => 0,
    rolls: [],
  };
  return { ctx, calls, rolls };
}

describe('failure fx: counting and the insight check', () => {
  it('first failure: attempts 1, insight DC 13', () => {
    const { ctx, calls } = ctxFor();
    expect(failureFx(ctx)).toEqual({ kind: 'escalate', fx: 'failure', reason: 'no_variation' });
    expect(ctx.state.attempts[KEY]).toBe(1);
    expect(calls).toEqual([{ fx: 'insight', score: 3, dc: 13, prof: 0 }]);
  });

  it('the DC falls one point per failure: attempts 1 to 5 give DC 13 to 9', () => {
    for (let attempts = 1; attempts <= 5; attempts++) {
      const { ctx, calls } = ctxFor({ state: stateWith(attempts - 1), failureCap: 6 });
      failureFx(ctx);
      expect(ctx.state.attempts[KEY]).toBe(attempts);
      expect(calls[0]?.dc).toBe(14 - attempts);
    }
  });

  it('same goal and program with different arguments keep counting', () => {
    const state = stateWith();
    const first = ctxFor({ state });
    failureFx(first.ctx);
    state.last_intent = { ...LAST, arguments: { status: 'other' } };
    const second = ctxFor({ state });
    failureFx(second.ctx);
    expect(state.attempts[KEY]).toBe(2);
    expect(problemKey(LAST.goal, LAST.program)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('past the cap escalates failure_past_cap with no roll, for cleverness 1 to 5 at caps 2 to 6', () => {
    for (let cleverness = 1; cleverness <= 5; cleverness++) {
      for (let base = 2; base <= 6; base++) {
        const cap = retryCap(cleverness as Score, base);
        const at = ctxFor({ cleverness, failureCap: base, state: stateWith(cap - 1) });
        expect(failureFx(at.ctx)).toEqual({
          kind: 'escalate',
          fx: 'failure',
          reason: 'failure_past_cap',
        });
        expect(at.calls).toEqual([]);
        // One failure short of the cap still rolls.
        const below = ctxFor({ cleverness, failureCap: base, state: stateWith(cap - 2) });
        failureFx(below.ctx);
        expect(below.calls).toHaveLength(1);
      }
    }
  });

  it('an intent_finished event clears the count; a different goal starts at 1', () => {
    const state = stateWith(2);
    state.tried[KEY] = ['abc'];
    const done = ctxFor({ state, events: [FINISHED] });
    expect(failureFx(done.ctx)).toEqual({ kind: 'pass' });
    expect(state.attempts[KEY]).toBeUndefined();
    expect(state.tried[KEY]).toBeUndefined();

    state.last_intent = { goal: 'build shelter', program: 'mine', arguments: {} };
    failureFx(ctxFor({ state }).ctx);
    expect(state.attempts[problemKey('build shelter', 'mine')]).toBe(1);
  });

  it('insight success returns the repeat_failure fact with stop, and a later fx does not run', () => {
    let laterRan = false;
    const later: Fx = () => {
      laterRan = true;
      return { kind: 'pass' };
    };
    const { ctx } = ctxFor({ success: true });
    const result = decide(ctx, [failureFx, later]);
    expect(result).toMatchObject({
      kind: 'pass-with-facts',
      facts: ['You have tried this 1 times and it has not worked.'],
    });
    expect(laterRan).toBe(false);
  });

  it('insight failure under the cap escalates no_variation and sends no act', () => {
    let actSent = false;
    const act: Fx = () => {
      actSent = true;
      return {
        kind: 'act',
        fx: 'idle',
        why: 'test',
        act: { tool: 'act', arguments: { program: 'walk' } },
      };
    };
    const { ctx } = ctxFor({ success: false });
    const result = decide(ctx, [failureFx, act]);
    expect(result).toMatchObject({ kind: 'pass', reason: 'no_variation' });
    expect(actSent).toBe(false);
  });

  it('rolls off: cleverness 3 fails at DC 13 and succeeds at DC 9', () => {
    const first = ctxFor({ failureCap: 6 });
    expect(failureFx(first.ctx)).toEqual({
      kind: 'escalate',
      fx: 'failure',
      reason: 'no_variation',
    });
    expect(first.rolls[0]?.success).toBe(false);

    const fifth = ctxFor({ failureCap: 6, state: stateWith(4) });
    expect(failureFx(fifth.ctx)).toEqual({
      kind: 'facts',
      fx: 'failure',
      stop: true,
      facts: ['You have tried this 5 times and it has not worked.'],
    });
    expect(fifth.calls[0]?.dc).toBe(9);
    expect(fifth.rolls[0]?.success).toBe(true);
  });

  it('three failure lines in one wake count once', () => {
    const { ctx, calls } = ctxFor({
      events: [FAILED, FAILED, { kind: 'action_failed', text: 'no' }],
    });
    failureFx(ctx);
    expect(ctx.state.attempts[KEY]).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('every roll the failure fx makes has bonus 0', () => {
    expect(PROFICIENCY_DEGRADED).toBe(true);
    for (let attempts = 0; attempts <= 4; attempts++) {
      const { ctx, calls, rolls } = ctxFor({ failureCap: 6, state: stateWith(attempts) });
      failureFx(ctx);
      expect(calls.every((call) => call.prof === 0)).toBe(true);
      expect(rolls.every((roll) => roll.bonus === 0)).toBe(true);
    }
  });

  it('a wake with no failure line and a wake with no last intent both pass with no roll', () => {
    const none = ctxFor({ events: [] });
    expect(failureFx(none.ctx)).toEqual({ kind: 'pass' });
    expect(none.calls).toEqual([]);
    const noLast = ctxFor({ state: stateWith(0, null) });
    expect(failureFx(noLast.ctx)).toEqual({ kind: 'pass' });
    expect(noLast.calls).toEqual([]);
  });
});
