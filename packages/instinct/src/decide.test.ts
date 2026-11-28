import type { Sheet } from '@geldar/scriptorium-psyche';
import { describe, expect, it } from 'vitest';
import { decide, type Fx, type FxContext } from './decide.ts';
import type { Observation } from './observe.ts';
import { emptyState } from './state.ts';

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

/** A context with a stub sheet: decide never reads it, so the cast is only for the test. */
function ctxFor(obs: Partial<Observation> = {}, state = emptyState()): FxContext {
  return {
    obs: { ...noObs, ...obs },
    sheet: {} as Sheet,
    state,
    cfg: { arm: 'instinct', failureCap: 4, maxPicks: 3, thinkP: 0.25, rolls: true },
    lifeKey: 'life',
    tick: 1,
    goal: null,
    knownText: '',
    check: () => {
      throw new Error('no check in this test');
    },
    draw: () => 0,
    rolls: [],
  };
}

const act: Fx = () => ({
  kind: 'act',
  fx: 'idle',
  why: 'habit for the top goal',
  act: { tool: 'act', arguments: { program: 'walk' } },
});

describe('decide', () => {
  it('a dead agent passes with dead, not forced', () => {
    expect(decide(ctxFor({ dead: true }), [act])).toEqual({
      v: 1,
      kind: 'pass',
      reason: 'dead',
      forced: false,
      rolls: [],
    });
  });

  it('speech to the agent passes with speech_addressed, forced', () => {
    const events = [{ kind: 'speech_to_me' as const, text: 'Ann says to you: hi', from: 'Ann' }];
    expect(decide(ctxFor({ events }), [act])).toMatchObject({
      kind: 'pass',
      reason: 'speech_addressed',
      forced: true,
    });
  });

  it('a first-time agent passes with first_sighting, forced, and a second waking does not', () => {
    const state = emptyState();
    const obs = { agents: [{ name: 'Ann', distance: 4 }] };
    expect(decide(ctxFor(obs, state), [act])).toMatchObject({
      kind: 'pass',
      reason: 'first_sighting',
      forced: true,
    });
    expect(state.seen).toEqual(['agent:ann']);
    expect(decide(ctxFor(obs, state), [act])).toMatchObject({ kind: 'settle', fx: 'idle' });
  });

  it('an act settles with an empty world line for run.ts to fill', () => {
    expect(decide(ctxFor(), [act])).toEqual({
      v: 1,
      kind: 'settle',
      fx: 'idle',
      why: 'habit for the top goal',
      act: { tool: 'act', arguments: { program: 'walk' } },
      rolls: [],
      world: { accepted: true, line: '' },
    });
  });

  it('an escalation passes with its reason and is forced only for a forced reason', () => {
    const esc: Fx = () => ({ kind: 'escalate', fx: 'failure', reason: 'failure_past_cap' });
    expect(decide(ctxFor(), [esc])).toMatchObject({
      kind: 'pass',
      reason: 'failure_past_cap',
      forced: true,
    });
    const soft: Fx = () => ({ kind: 'escalate', fx: 'idle', reason: 'think_draw' });
    expect(decide(ctxFor(), [soft])).toMatchObject({
      kind: 'pass',
      reason: 'think_draw',
      forced: false,
    });
  });

  it('pass continues to the next fx; facts without an act give pass-with-facts, capped at 4', () => {
    const pass: Fx = () => ({ kind: 'pass' });
    const many: Fx = () => ({ kind: 'facts', fx: 'novelty', facts: ['a', 'b', 'c'] });
    const more: Fx = () => ({ kind: 'facts', fx: 'novelty', facts: ['d', 'e'] });
    expect(decide(ctxFor(), [pass, many, more, act])).toMatchObject({ kind: 'settle' });
    expect(decide(ctxFor(), [many, more])).toEqual({
      v: 1,
      kind: 'pass-with-facts',
      fx: 'novelty',
      facts: ['a', 'b', 'c', 'd'],
      rolls: [],
    });
  });

  it('a facts result with stop ends the loop before the act', () => {
    const stop: Fx = () => ({ kind: 'facts', fx: 'failure', facts: ['x'], stop: true });
    expect(decide(ctxFor(), [stop, act])).toMatchObject({ kind: 'pass-with-facts', facts: ['x'] });
  });

  it('nothing to do passes with nothing_to_do', () => {
    expect(decide(ctxFor(), [])).toMatchObject({
      kind: 'pass',
      reason: 'nothing_to_do',
      forced: false,
    });
  });
});
