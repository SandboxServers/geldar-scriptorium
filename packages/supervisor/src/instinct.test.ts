import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Behaviour, makeFixture, onPoll } from './fixture.ts';
import { instinctEnv } from './instinct.ts';
import { readSettings, SettingError } from './settings.ts';
import { childEnv } from './supervisor.ts';

const ON = { GELDAR_INSTINCT: 'on' };

type Instinct = NonNullable<Behaviour['instinct']>;

const SETTLE = {
  v: 1,
  kind: 'settle',
  fx: 'idle',
  why: 'the character is idle',
  act: { tool: 'act', arguments: { text: 'wave' } },
  rolls: [],
  world: { accepted: true, line: 'You wave.' },
};

const FACTS = {
  v: 1,
  kind: 'pass-with-facts',
  fx: 'failure',
  facts: ['The door will not open.'],
  rolls: [],
};

// The model run of waking 1 with the instinct step answering `instinct`, stopped after its sleep.
function oneWaking(instinct: Instinct = {}, env: Record<string, string> = ON) {
  const f = makeFixture({ secs: 60, instinct }, env);
  onPoll(f, () => f.supervisor.requestStop());
  return f;
}

describe('instinct step: off and settle', () => {
  it('off by default: the child is never started and no instinct.jsonl is written', async () => {
    const f = makeFixture({ secs: 60 });
    onPoll(f, () => f.supervisor.requestStop());
    expect(await f.supervisor.run()).toBe(0);
    expect(f.selfSpecs).toHaveLength(0);
    expect(f.has('instinct.jsonl')).toBe(false);
    expect(f.runs()).toHaveLength(1);
  });

  it('settle: the supervisor starts no model run, skips save and costs, sleeps delayBase and the run number is reused', async () => {
    const f = makeFixture({ secs: 60 }, ON);
    // The first instinct call settles; every later call passes.
    const real = f.deps.execSelf;
    let calls = 0;
    f.deps.execSelf = async (spec) => {
      calls++;
      if (calls > 1) return real(spec);
      f.selfSpecs.push(spec);
      writeFileSync(spec.stdoutPath, JSON.stringify(SETTLE));
      return 0;
    };
    onPoll(f, (poll) => {
      if (poll === 2) f.supervisor.requestStop();
    });
    expect(await f.supervisor.run()).toBe(0);
    expect(f.sleeps[0]).toBe(f.settings.delayBase);
    expect(f.selfSpecs.map((s) => s.args)).toEqual([
      ['run', '--run', '1'],
      ['run', '--run', '1'],
    ]);
    // Only the model run of waking 1 is in the cost and token lines: the settle left no line.
    expect(f.runs()).toHaveLength(1);
    const costs = f.read('costs.csv').split('\n').filter(Boolean);
    expect(costs).toHaveLength(1);
    expect(costs[0]?.startsWith('1,')).toBe(true);
    expect(f.read('supervisor.log')).toContain('instinct settled run=1 fx=idle');
  });
});

describe('instinct step: facts and pass', () => {
  it('pass-with-facts: the prompt file holds the base text, then the facts, on one paragraph', async () => {
    const base = oneWaking({});
    await base.supervisor.run();
    const f = oneWaking({ out: FACTS });
    await f.supervisor.run();
    const withFacts = f.read('prompt.txt');
    expect(withFacts).toBe(`${base.read('prompt.txt').slice(0, -1)} The door will not open.\n`);
    expect(withFacts.split('\n')).toHaveLength(2);
  });

  it('no facts: the prompt is byte for byte as before', async () => {
    const off = makeFixture({ secs: 60 });
    onPoll(off, () => off.supervisor.requestStop());
    await off.supervisor.run();
    const pass = oneWaking({
      out: { v: 1, kind: 'pass', reason: 'nothing_to_do', forced: false, rolls: [] },
    });
    await pass.supervisor.run();
    expect(pass.read('prompt.txt')).toBe(off.read('prompt.txt'));
  });

  it('pass: unchanged', async () => {
    const f = oneWaking({
      out: { v: 1, kind: 'pass', reason: 'nothing_to_do', forced: false, rolls: [] },
    });
    expect(await f.supervisor.run()).toBe(0);
    expect(f.runs()).toHaveLength(1);
    expect(f.has('instinct.jsonl')).toBe(false);
    expect(f.read('supervisor.log')).toContain('fails=0');
  });
});

describe('instinct step: errors fail safe', () => {
  const cases: Array<[string, Instinct, string]> = [
    ['a crashing child (exit 1)', { rc: 1 }, 'exit'],
    ['a timeout', { rc: 124 }, 'timeout'],
    ['garbage output', { out: 'not a result' }, 'bad_output'],
  ];
  for (const [name, instinct, reason] of cases) {
    it(`${name} logs an error line, runs the model normally and never raises the failure count`, async () => {
      const f = oneWaking(instinct);
      expect(await f.supervisor.run()).toBe(0);
      const lines = f
        .read('instinct.jsonl')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      expect(lines).toEqual([
        expect.objectContaining({
          kind: 'error',
          reason,
          run: 1,
          model_called: true,
          source: 'instinct',
        }),
      ]);
      expect(f.runs()).toHaveLength(1);
      expect(f.read('supervisor.log')).toContain('fails=0');
    });
  }

  it('five instinct failures in a row never auto-STOP the supervisor', async () => {
    const f = makeFixture({ secs: 60, instinct: { rc: 1 } }, ON);
    onPoll(f, (poll) => {
      if (poll === 6) f.supervisor.requestStop();
    });
    expect(await f.supervisor.run()).toBe(0);
    expect(f.read('instinct.jsonl').split('\n').filter(Boolean)).toHaveLength(6);
    expect(f.has('STOP')).toBe(false);
    expect(f.said.join('\n')).not.toContain('stopped itself');
  });

  it('a tidy waking does not run the instinct step', async () => {
    const f = makeFixture({ secs: 60 }, { ...ON, GELDAR_TIDY_BYTES: '100' });
    mkdirSync(join(f.settings.workspace, 'memory', 'journal'), { recursive: true });
    writeFileSync(join(f.settings.workspace, 'memory', 'journal', 'current.md'), 'x'.repeat(500));
    onPoll(f, () => f.supervisor.requestStop());
    await f.supervisor.run();
    expect(f.selfSpecs).toHaveLength(0);
    expect(f.runs()).toHaveLength(1);
  });
});

describe('instinct step: environments and settings', () => {
  const all = {
    GELDAR_INSTINCT: 'on',
    GELDAR_INSTINCT_ARM: 'arm-two',
    GELDAR_INSTINCT_FAILURE_CAP: '6',
    GELDAR_INSTINCT_MAX_PICKS: '2',
    GELDAR_INSTINCT_THINK_P: '0.5',
    GELDAR_INSTINCT_ROLLS: 'off',
    GELDAR_INSTINCT_SANITY: 'off',
    GELDAR_INSTINCT_TIMEOUT: '30',
  };
  const host = {
    ...all,
    PATH: '/usr/bin',
    GELDAR_MCP_URL: 'http://proxy/p/x',
    GELDAR_MCP_TOKEN: 'mcp-token',
    HTTP_PROXY: 'http://p:3128',
    HTTPS_PROXY: 'http://p:3128',
    NO_PROXY: 'localhost',
    http_proxy: 'http://p:3128',
    https_proxy: 'http://p:3128',
    no_proxy: 'localhost',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth-secret',
    GELDAR_SHEET: 'sheet-secret',
    GELDAR_RUN_MODEL: 'model-x',
  };

  it('instinctEnv has exactly the contract names and no CLAUDE_CODE_OAUTH_TOKEN', () => {
    const settings = readSettings({ ...host, GELDAR_SUPERVISOR_STATE: '/state/sup' });
    const env = instinctEnv(settings, host);
    expect(Object.keys(env).sort()).toEqual(
      [
        'PATH',
        'HOME',
        'NODE_USE_ENV_PROXY',
        'HTTP_PROXY',
        'HTTPS_PROXY',
        'NO_PROXY',
        'http_proxy',
        'https_proxy',
        'no_proxy',
        'GELDAR_MCP_URL',
        'GELDAR_MCP_TOKEN',
        'GELDAR_WORKSPACE',
        'GELDAR_INSTINCT_STATE',
        'GELDAR_HARNESS',
        'GELDAR_RUN_MODEL',
        'GELDAR_INSTINCT',
        'GELDAR_INSTINCT_ARM',
        'GELDAR_INSTINCT_FAILURE_CAP',
        'GELDAR_INSTINCT_MAX_PICKS',
        'GELDAR_INSTINCT_THINK_P',
        'GELDAR_INSTINCT_ROLLS',
        'GELDAR_INSTINCT_SANITY',
        'GELDAR_INSTINCT_TIMEOUT',
      ].sort(),
    );
    expect(env.GELDAR_INSTINCT_STATE).toBe(join('/state/sup', 'instinct'));
    expect(Object.values(env).join(' ')).not.toContain('oauth-secret');
    expect(Object.values(env).join(' ')).not.toContain('sheet-secret');
  });

  it('childEnv has no GELDAR_INSTINCT name even when the supervisor environment sets them all', () => {
    const settings = readSettings(host);
    const env = childEnv(settings, host);
    expect(Object.keys(env).filter((k) => /INSTINCT/i.test(k))).toEqual([]);
    expect(Object.values(env).join(' ')).not.toContain('arm-two');
  });

  it('readSettings: defaults, and each bad value names its variable', () => {
    const defaults = readSettings({}).instinct;
    expect(defaults).toEqual({
      enabled: false,
      arm: 'instinct',
      failureCap: 4,
      maxPicks: 3,
      thinkP: 0.25,
      rolls: true,
      sanity: false,
      timeoutSecs: 60,
    });
    const bad: Array<[string, string]> = [
      ['GELDAR_INSTINCT', 'yes'],
      ['GELDAR_INSTINCT_ARM', 'Bad Arm'],
      ['GELDAR_INSTINCT_FAILURE_CAP', '0'],
      ['GELDAR_INSTINCT_MAX_PICKS', '21'],
      ['GELDAR_INSTINCT_THINK_P', '1.5'],
      ['GELDAR_INSTINCT_ROLLS', 'maybe'],
      ['GELDAR_INSTINCT_SANITY', 'x'],
      ['GELDAR_INSTINCT_TIMEOUT', '601'],
    ];
    for (const [name, value] of bad) {
      expect(() => readSettings({ [name]: value })).toThrow(SettingError);
      expect(() => readSettings({ [name]: value })).toThrow(name);
    }
  });
});
