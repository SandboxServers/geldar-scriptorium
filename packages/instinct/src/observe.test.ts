import { describe, expect, it } from 'vitest';
import { classifyLine, observe, parseObservation } from './observe.ts';

const status = JSON.stringify({
  tick: 12,
  dead: false,
  night: true,
  position: { x: 1, y: 64, z: -3 },
  health: 18,
  hunger: 14,
  inventory: { bread: 2, stone: 'many' },
  food_carried: true,
  inventory_full: false,
  agents: [{ name: 'Ann', distance: 4 }, { distance: 2 }],
  entities: [{ kind: 'zombie', hostile: true, distance: 9 }],
  notable: [{ kind: 'chest', distance: 3 }],
  intent: { goal: 'eat', program: 'eat', arguments: { item: 'bread' } },
  cursor: 'c-9',
});

describe('observe', () => {
  it('reads the status fields and drops what is malformed', () => {
    const obs = parseObservation(status, '');
    expect(obs.tick).toBe(12);
    expect(obs.position).toEqual({ x: 1, y: 64, z: -3 });
    expect(obs.inventory).toEqual({ bread: 2 });
    expect(obs.agents).toEqual([{ name: 'Ann', distance: 4 }]);
    expect(obs.intent).toEqual({ goal: 'eat', program: 'eat', arguments: { item: 'bread' } });
    expect(obs.cursor).toBe('c-9');
  });

  it('a position needs all three numbers', () => {
    expect(parseObservation(JSON.stringify({ position: { x: 1, y: 2 } }), '').position).toBeNull();
  });

  it('a reply the world did not understand gives nulls and empty lists, never a throw', () => {
    const obs = parseObservation('not json at all', '');
    expect(obs).toMatchObject({
      tick: null,
      night: null,
      health: null,
      position: null,
      intent: null,
      cursor: null,
    });
    expect(obs.agents).toEqual([]);
    expect(obs.events).toEqual([]);
    expect(obs.dead).toBe(false);
  });

  it('classifies the sentences the play skills name', () => {
    expect(classifyLine('Your intent finished.')?.kind).toBe('intent_finished');
    expect(classifyLine('Your intent ran out of time.')?.kind).toBe('intent_failed');
    expect(classifyLine('Your intent failed: no path.')?.kind).toBe('intent_failed');
    expect(classifyLine('Your mine failed: no tool.')?.kind).toBe('action_failed');
    expect(classifyLine('Ann says to you: hello')).toEqual({
      kind: 'speech_to_me',
      text: 'Ann says to you: hello',
      from: 'Ann',
    });
    expect(classifyLine('Ann says: hello')?.kind).toBe('speech');
    expect(classifyLine('It is raining.')?.kind).toBe('other');
    expect(classifyLine('   ')).toBeNull();
  });

  it('truncates event text to 200 characters and keeps it as text only', () => {
    const line = classifyLine(`Ann says: ${'x'.repeat(300)}`);
    expect(line?.text.length).toBe(200);
  });

  it('observe calls status, then wait with max_seconds 1 and the cursor only when there is one', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const world = {
      async call(name: string, args: Record<string, unknown>): Promise<string> {
        calls.push([name, args]);
        return name === 'status' ? status : 'Your intent finished.';
      },
    };
    const obs = await observe(world, 'c-8');
    expect(calls).toEqual([
      ['status', {}],
      ['wait', { max_seconds: 1, cursor: 'c-8' }],
    ]);
    expect(obs.events[0]?.kind).toBe('intent_finished');
    calls.length = 0;
    await observe(world, null);
    expect(calls[1]).toEqual(['wait', { max_seconds: 1 }]);
  });
});
