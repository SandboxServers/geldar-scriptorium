import { describe, expect, it } from 'vitest';
import { makeFixture, onPoll } from './fixture.ts';
import { readSettings } from './settings.ts';
import { childEnv } from './supervisor.ts';

// A run of 120 tokens: 100 input (uncached), 20 output.
const spent = { usage: { input_tokens: 100, output_tokens: 20 } };

describe('the harness and model stamp', () => {
  it('stamps status, costs, tokens and the checkpoint request with the harness and model', async () => {
    const f = makeFixture(spent, { GELDAR_HARNESS: 'chatgpt', GELDAR_RUN_MODEL: 'm1' });
    onPoll(f, () => f.supervisor.requestStop());
    await f.supervisor.run();
    const status = JSON.parse(f.read('status.json'));
    expect([status.harness, status.model]).toEqual(['chatgpt', 'm1']);
    const cost = f.read('costs.csv').trimEnd().split(',');
    expect(cost).toHaveLength(6);
    expect(cost.slice(4)).toEqual(['chatgpt', 'm1']);
    const tokens = f.read('tokens.csv').trimEnd().split(',');
    expect(tokens).toHaveLength(7);
    expect(tokens.slice(5)).toEqual(['chatgpt', 'm1']);
    expect(JSON.parse(f.read('checkpoint-request'))).toEqual({
      run: 1,
      harness: 'chatgpt',
      model: 'm1',
    });
  });

  it('stamps a claude run with no model as an empty model', async () => {
    const f = makeFixture(spent);
    onPoll(f, () => f.supervisor.requestStop());
    await f.supervisor.run();
    const status = JSON.parse(f.read('status.json'));
    expect([status.harness, status.model]).toEqual(['claude', '']);
    expect(f.read('costs.csv').trimEnd()).toMatch(/,claude,$/);
    expect(JSON.parse(f.read('checkpoint-request'))).toEqual({
      run: 1,
      harness: 'claude',
      model: '',
    });
  });

  it('gives every child the harness in GELDAR_HARNESS', () => {
    const settings = readSettings({ GELDAR_HARNESS: 'chatgpt' });
    expect(childEnv(settings, {}).GELDAR_HARNESS).toBe('chatgpt');
    expect(childEnv(readSettings({}), {}).GELDAR_HARNESS).toBe('claude');
  });
});
