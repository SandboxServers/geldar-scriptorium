import { describe, expect, it } from 'vitest';
import {
  BAD_CURSOR,
  classifyEvent,
  observe,
  parseObservation,
  type WorldCalls,
} from './observe.ts';

// Fixtures follow contract/schemas: mcp-play.schema.json WaitResult, mcp-common.schema.json PlaySnapshot and McpPlayerEvent.
function waitReply(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    snapshot: {
      agent_id: 'p_test',
      revision: 3,
      world_time: { day: 4, time_of_day: 'night', weather: 'clear' },
      self: {
        position: { x: 10, y: 64, z: -3 },
        health: 18,
        hunger: 14,
        armor: 0,
        held_item: null,
        inventory: [
          { item: 'oak_log', count: 3 },
          { item: 'bread', count: 2, edible: true },
          { item: 'oak_log', count: 2 },
        ],
        effects: [],
        budget_remaining_thoughts: 20,
        days_since_sleep: 1,
      },
      surroundings: {
        blocks_summary: 'grass and oak',
        notable_blocks: [{ type: 'furnace', x: 1, y: 64, z: 1, lit: true }],
        entities: [
          { type: 'zombie', distance: 6, direction: 'north', x: 4, y: 64, z: -9, hostile: true },
          { type: 'cow', distance: 4, direction: 'east', x: 14, y: 64, z: -3 },
        ],
        agents: [{ name: 'Ann', distance: 5, held_item: null, health_estimate: 'full' }],
      },
      heard: [],
      events_since_last_thought: [],
      current_plan: { goal: 'gather_oak_log', action: 'gather', status: 'running' },
    },
    events: [],
    cursor: 'c_8',
    wake_reason: 'timeout',
    dropped_events: 0,
    untrusted_world_text: { speech: [{ from: 'Ann', text: 'hello there' }] },
    ...extra,
  });
}

function fakeWorld(
  replies: (string | Error)[],
): WorldCalls & { calls: [string, Record<string, unknown>][] } {
  const calls: [string, Record<string, unknown>][] = [];
  return {
    calls,
    async call(name, args) {
      calls.push([name, args]);
      const next = replies.shift();
      if (next === undefined) throw new Error('no reply scripted');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

describe('parseObservation on the real wait shapes', () => {
  it('reads position, health, hunger, inventory array, agents, entities and notable blocks', () => {
    const obs = parseObservation(waitReply());
    expect(obs.position).toEqual({ x: 10, y: 64, z: -3 });
    expect(obs.health).toBe(18);
    expect(obs.hunger).toBe(14);
    expect(obs.inventory).toEqual({ oak_log: 5, bread: 2 });
    expect(obs.foodCarried).toBe(true);
    expect(obs.agents).toEqual([{ name: 'Ann', distance: 5 }]);
    expect(obs.entities).toEqual([
      { kind: 'zombie', hostile: true, distance: 6 },
      { kind: 'cow', hostile: false, distance: 4 },
    ]);
    expect(obs.notable).toEqual([{ kind: 'furnace', distance: null }]);
  });

  it('reads night from world_time, the plan from current_plan, and the cursor when it matches the contract', () => {
    const obs = parseObservation(waitReply());
    expect(obs.night).toBe(true);
    expect(obs.intent).toEqual({
      goal: 'gather_oak_log',
      program: 'gather',
      arguments: { status: 'running' },
    });
    expect(obs.cursor).toBe('c_8');
    expect(obs.tick).toBeNull();
    // No death event in this reply, so not dead (dead comes from a death event, see the death test below).
    expect(obs.dead).toBe(false);
    expect(obs.inventoryFull).toBeNull();
  });

  it('rejects a cursor that does not match ^c_[0-9]{1,12}$', () => {
    expect(parseObservation(waitReply({ cursor: 'c-8' })).cursor).toBeNull();
    expect(parseObservation(waitReply({ cursor: 'c_1234567890123' })).cursor).toBeNull();
  });

  it('gives null, {} and [] for a reply with no snapshot', () => {
    const obs = parseObservation('{}');
    expect(obs.position).toBeNull();
    expect(obs.night).toBeNull();
    expect(obs.foodCarried).toBeNull();
    expect(obs.inventory).toEqual({});
    expect(obs.agents).toEqual([]);
    expect(obs.intent).toBeNull();
    expect(obs.events).toEqual([]);
  });
});

describe('events are objects classified by type', () => {
  it('speech_to_me takes its speaker from untrusted_world_text.speech', () => {
    const obs = parseObservation(
      waitReply({
        events: [{ seq: 1, type: 'speech_to_me', tick: 9, text: 'Ann says to you: hello there' }],
      }),
    );
    expect(obs.events).toEqual([
      { kind: 'speech_to_me', text: 'Ann says to you: hello there', from: 'Ann' },
    ]);
  });

  it('maps intent_finished, action_failed, damage and death by type', () => {
    const obs = parseObservation(
      waitReply({
        events: [
          { seq: 1, type: 'intent_finished', tick: 1, text: 'Your intent finished.' },
          { seq: 2, type: 'action_failed', tick: 2, text: 'Your mine failed: no tool.' },
          { seq: 3, type: 'damage', tick: 3, text: 'You were hurt by a zombie.' },
          { seq: 4, type: 'death', tick: 4, text: 'You died.' },
        ],
      }),
    );
    expect(obs.events.map((e) => e.kind)).toEqual([
      'intent_finished',
      'action_failed',
      'hurt',
      'death',
    ]);
  });

  it('a type intent_finished event with a failure text is intent_failed (the world sends this for every outcome)', () => {
    expect(classifyEvent('intent_finished', 'Your intent failed: no path.', null).kind).toBe(
      'intent_failed',
    );
    expect(classifyEvent('intent_finished', 'Your intent ran out of time.', null).kind).toBe(
      'intent_failed',
    );
    expect(classifyEvent('intent_finished', 'Your intent finished.', null).kind).toBe(
      'intent_finished',
    );
    expect(classifyEvent('intent_finished', 'anything', null).kind).toBe('intent_finished');
  });

  it('a wait with a death event is dead', () => {
    const obs = parseObservation(
      waitReply({ events: [{ seq: 4, type: 'death', tick: 4, text: 'You died.' }] }),
    );
    expect(obs.dead).toBe(true);
    expect(obs.events).toEqual([{ kind: 'death', text: 'You died.' }]);
  });

  it('matches the bare intent failure and plan stop texts', () => {
    expect(classifyEvent('', 'Your intent failed.', null).kind).toBe('intent_failed');
    expect(classifyEvent('', 'Your intent ran out of time.', null).kind).toBe('intent_failed');
    expect(classifyEvent('', 'Your plan stopped: no path to the tree.', null).kind).toBe(
      'intent_failed',
    );
    expect(classifyEvent('other', 'something else', null).kind).toBe('other');
  });

  it('cuts event text to 200 characters', () => {
    const long = 'x'.repeat(300);
    expect(classifyEvent('other', long, null).text).toHaveLength(200);
  });

  it('classifies plain lines when the reply is not JSON', () => {
    const obs = parseObservation('Your intent finished.\nYour intent failed.');
    expect(obs.events.map((e) => e.kind)).toEqual(['intent_finished', 'intent_failed']);
  });
});

describe('observe calls wait only', () => {
  it('sends max_seconds 5 and the cursor when there is one', async () => {
    const world = fakeWorld([waitReply()]);
    const obs = await observe(world, 'c_7');
    expect(world.calls).toEqual([['wait', { max_seconds: 5, cursor: 'c_7' }]]);
    expect(obs.cursor).toBe('c_8');
  });

  it('sends no cursor key on the first wake', async () => {
    const world = fakeWorld([waitReply()]);
    await observe(world, null);
    expect(world.calls).toEqual([['wait', { max_seconds: 5 }]]);
  });

  it('sends no cursor key when the stored cursor does not match the contract shape', async () => {
    const world = fakeWorld([waitReply()]);
    await observe(world, 'c-9');
    expect(world.calls).toEqual([['wait', { max_seconds: 5 }]]);
  });

  it('retries once with no cursor on bad_cursor, and gives the new cursor', async () => {
    const world = fakeWorld([new Error(BAD_CURSOR), waitReply()]);
    const obs = await observe(world, 'c_99');
    expect(world.calls).toEqual([
      ['wait', { max_seconds: 5, cursor: 'c_99' }],
      ['wait', { max_seconds: 5 }],
    ]);
    expect(obs.cursor).toBe('c_8');
  });

  it('does not retry an error that is not bad_cursor', async () => {
    const world = fakeWorld([new Error('world refused the call')]);
    await expect(observe(world, 'c_99')).rejects.toThrow('world refused the call');
    expect(world.calls).toHaveLength(1);
  });

  it('gives up after the second bad_cursor (the retry is not repeated)', async () => {
    const world = fakeWorld([new Error(BAD_CURSOR), new Error(BAD_CURSOR)]);
    await expect(observe(world, 'c_99')).rejects.toThrow(BAD_CURSOR);
    expect(world.calls).toHaveLength(2);
  });
});
