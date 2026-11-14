import { describe, expect, it } from 'vitest';
import { type Behaviour, makeFixture, onPoll } from './fixture.ts';
import { readSettings, SettingError } from './settings.ts';

// A Claude run of 120 tokens: 100 input (uncached), 20 output.
const spent: Behaviour = {
  usage: { input_tokens: 100, output_tokens: 20 },
};

describe('the token meter', () => {
  it('appends one tokens.csv line per run: run, UTC time, input, cached, output', async () => {
    const f = makeFixture({
      usage: { input_tokens: 10, cache_read_input_tokens: 4, output_tokens: 6 },
    });
    onPoll(f, () => f.supervisor.requestStop());
    await f.supervisor.run();
    expect(f.read('tokens.csv')).toMatch(/^1,\S+,10,4,6,claude,\n$/);
  });

  it('reads the owned-loop usage shape for the chatgpt harness', async () => {
    const f = makeFixture(
      { usage: { input_tokens: 50, cached_input_tokens: 40, output_tokens: 3 } },
      { GELDAR_HARNESS: 'chatgpt' },
    );
    onPoll(f, () => f.supervisor.requestStop());
    await f.supervisor.run();
    expect(f.read('tokens.csv')).toMatch(/^1,\S+,50,40,3,chatgpt,\n$/);
  });

  it('sleeps to the next UTC day when the daily token cap is reached, and starts no second run', async () => {
    const f = makeFixture(spent, { GELDAR_RUN_DAILY_TOKEN_CAP: '100' });
    let clockAt = 0;
    let state = '';
    onPoll(f, (poll) => {
      if (poll !== 2) return;
      // The cap sleep: the first run is over and the day's tokens are over the cap.
      clockAt = f.clock();
      state = JSON.parse(f.read('status.json')).state;
      f.supervisor.requestStop();
    });
    await f.supervisor.run();
    expect(f.runs()).toHaveLength(1);
    expect(f.sleeps[1]).toBe(86400 - (clockAt % 86400));
    expect(state).toBe('sleeping');
    expect(JSON.parse(f.read('status.json')).tokens_today).toBe(120);
    expect(f.read('supervisor.log')).toContain('token cap reached');
    expect(f.said).toContain(
      'The daily token cap (100 tokens) is reached; waiting for the next day.',
    );
  });

  it('never sleeps for tokens when the cap is 0', async () => {
    const f = makeFixture(spent);
    onPoll(f, (poll) => {
      if (poll === 2) f.supervisor.requestStop();
    });
    await f.supervisor.run();
    expect(f.runs()).toHaveLength(2);
    expect(f.read('supervisor.log')).not.toContain('token cap reached');
  });

  it('refuses a daily token cap that is not a number', () => {
    expect(() => readSettings({ GELDAR_RUN_DAILY_TOKEN_CAP: 'abc' })).toThrow(SettingError);
    expect(readSettings({}).dailyTokenCap).toBe(0);
  });
});
