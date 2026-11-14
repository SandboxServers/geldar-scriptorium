import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeFixture } from './fixture.ts';
import { HELD_REASON, wrapperLine } from './supervisor.ts';

describe('the keeper HELD marker', () => {
  it('runs nothing while HELD is present at start, keeps beating and reports held', async () => {
    const f = makeFixture({ stopAt: 1 });
    const held = join(f.keeperDir, 'HELD');
    writeFileSync(held, 'rejected\n');
    const waits: number[] = [];
    const runsDuringHold: number[] = [];
    f.deps.sleep = async (secs) => {
      waits.push(secs);
      runsDuringHold.push(f.runs().length);
      if (waits.length === 1) {
        expect(f.read('status.json')).toMatch(/"state":"held"/);
        expect(f.read('status.json')).toMatch(/"held_reason":"rejected"/);
        writeFileSync(join(f.stateDir, 'heartbeat'), 'old\n');
        f.beats[0]?.();
        expect(f.read('heartbeat')).toBe('2026-01-10T23:00:00Z\n');
      }
      if (waits.length === 3) rmSync(held);
      // The run's own STOP idles the supervisor after the run: a stop request ends that loop.
      if (waits.length === 5) f.supervisor.requestStop();
    };
    expect(await f.supervisor.run()).toBe(0);
    expect(waits.slice(0, 3)).toEqual([10, 10, 10]);
    expect(runsDuringHold.slice(0, 3)).toEqual([0, 0, 0]);
    expect(f.runs()).toHaveLength(1);
    expect(f.beats).toHaveLength(1);
    expect(f.read('supervisor.log').match(/held by the keeper/g)).toHaveLength(1);
  });

  it('clears its own hold STOP when HELD is removed, and runs resume', async () => {
    let stopDuringRun: boolean | undefined;
    let stopFile = '';
    const f = makeFixture({
      stopAt: 1,
      during: () => {
        stopDuringRun = existsSync(stopFile);
      },
    });
    stopFile = join(f.stateDir, 'STOP');
    f.put('STOP', `auto: ${HELD_REASON}\n`);
    writeFileSync(join(f.keeperDir, 'HELD'), 'rejected\n');
    let waits = 0;
    f.deps.sleep = async () => {
      // The first wait clears HELD; the second (the idle loop after the run's own STOP) ends the test.
      if (++waits === 1) rmSync(join(f.keeperDir, 'HELD'));
      else f.supervisor.requestStop();
    };
    expect(await f.supervisor.run()).toBe(0);
    expect(f.runs()).toHaveLength(1);
    expect(stopDuringRun).toBe(false);
    expect(f.read('supervisor.log')).toContain('hold released');
  });

  it('starts normally when only a leftover hold STOP is present', async () => {
    const f = makeFixture({ stopAt: 1 });
    f.put('STOP', `auto: ${HELD_REASON}\n`);
    expect(await f.supervisor.run()).toBe(0);
    expect(f.runs()).toHaveLength(1);
  });

  it('stops further runs when HELD appears between runs, and idles until a stop', async () => {
    const f = makeFixture({ heldAt: 1 });
    const inner = f.deps.sleep;
    let holdWaits = 0;
    f.deps.sleep = async (secs, wake) => {
      if (!existsSync(join(f.keeperDir, 'HELD'))) return inner(secs, wake);
      // A safety net so a broken loop fails the assertions instead of running on. The stop request
      // ends the hold loop; a fake sleep that never yields would otherwise spin and hang the test run.
      if (++holdWaits === 3) {
        writeFileSync(join(f.stateDir, 'STOP'), 'x\n');
        f.supervisor.requestStop();
      }
    };
    expect(await f.supervisor.run()).toBe(0);
    expect(f.runs()).toHaveLength(1);
    expect(holdWaits).toBe(3);
    expect(f.read('STOP')).toBe('x\n');
    expect(f.read('status.json')).toMatch(/"state":"stopped"/);
  });

  it('leaves a STOP it did not write in place when HELD is removed, and idles on it', async () => {
    const f = makeFixture();
    const held = join(f.keeperDir, 'HELD');
    writeFileSync(held, 'rejected\n');
    let waits = 0;
    f.deps.sleep = async () => {
      if (++waits === 1) {
        writeFileSync(join(f.stateDir, 'STOP'), 'auto: 3 failed cycles in a row\n');
        rmSync(held);
      } else {
        f.supervisor.requestStop();
      }
    };
    expect(await f.supervisor.run()).toBe(0);
    expect(f.runs()).toHaveLength(0);
    expect(f.read('STOP')).toBe('auto: 3 failed cycles in a row\n');
    expect(f.read('status.json')).toMatch(/"state":"stopped"/);
  });

  it('exits 0 on a stop request while held, leaving the hold STOP for the next start', async () => {
    const f = makeFixture();
    writeFileSync(join(f.keeperDir, 'HELD'), 'rejected\n');
    f.deps.sleep = async () => f.supervisor.requestStop();
    expect(await f.supervisor.run()).toBe(0);
    expect(f.runs()).toHaveLength(0);
    expect(f.read('STOP')).toBe(`auto: ${HELD_REASON}\n`);
    expect(f.read('status.json')).toMatch(/"state":"stopped"/);
  });
});

describe('the child process', () => {
  const secret = 'sk-ant-oat01-SECRET-VALUE';
  const mcp = 'mcp-SECRET-VALUE';

  it('runs as the player with an explicit environment and no prompt in its arguments', async () => {
    const f = makeFixture(
      { stopAt: 1, last: 'hello' },
      { GELDAR_PLAYER_UID: '1234', GELDAR_PLAYER_GID: '4321', GELDAR_RUN_MODEL: 'opus' },
      {
        CLAUDE_CODE_OAUTH_TOKEN: secret,
        GELDAR_MCP_TOKEN: mcp,
        GELDAR_MCP_URL: 'https://world.example/p/p1',
        HTTPS_PROXY: 'http://proxy:3128',
      },
    );
    await f.supervisor.run();
    const spec = f.runs()[0];
    expect(spec).toBeDefined();
    if (!spec) return;
    expect([spec.uid, spec.gid]).toEqual([1234, 4321]);
    expect(spec.file).toBe('sh');
    expect(spec.args).toEqual(['-c', wrapperLine(f.settings)]);
    expect(spec.args[1]).toBe(
      'exec claude --autocompact 100000 --settings /etc/geldar/settings/play.json -p "$(cat <&3)" --max-turns "$GELDAR_RUN_MAX_TURNS" --model "$GELDAR_RUN_MODEL" --output-format stream-json --verbose',
    );
    expect(spec.env).toEqual({
      HOME: '/cli-home',
      CLAUDE_CONFIG_DIR: '/cli-home',
      GELDAR_MODE: 'play',
      PATH: '/usr/bin',
      GELDAR_HARNESS: 'claude',
      GELDAR_RUN_MAX_TURNS: '300',
      GELDAR_RUN_MODEL: 'opus',
      CLAUDE_CODE_OAUTH_TOKEN: secret,
      GELDAR_MCP_TOKEN: mcp,
      GELDAR_MCP_URL: 'https://world.example/p/p1',
      HTTPS_PROXY: 'http://proxy:3128',
    });
    expect(spec.stdoutPath).toBe(join(f.stateDir, 'session-1.jsonl'));
  });

  it('passes no token that the supervisor does not have, and no model flag when unset', async () => {
    const f = makeFixture({ stopAt: 1 });
    await f.supervisor.run();
    const spec = f.runs()[0];
    expect(Object.keys(spec?.env ?? {}).sort()).toEqual([
      'CLAUDE_CONFIG_DIR',
      'GELDAR_HARNESS',
      'GELDAR_MODE',
      'GELDAR_RUN_MAX_TURNS',
      'HOME',
      'PATH',
    ]);
    expect(spec?.args[1]).not.toContain('--model');
  });

  it('keeps tokens, prompts and stream text out of arguments and logs', async () => {
    const f = makeFixture(
      { stopAt: 2, last: 'PRIVATE-LAST-WORDS' },
      {},
      { CLAUDE_CODE_OAUTH_TOKEN: secret, GELDAR_MCP_TOKEN: mcp },
    );
    await f.supervisor.run();
    const args = JSON.stringify(f.specs.map((s) => s.args));
    for (const text of [args, f.read('supervisor.log'), f.read('status.json'), f.said.join('\n')]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain(mcp);
      expect(text).not.toContain('PRIVATE-LAST-WORDS');
    }
    expect(args).not.toContain('waking number');
  });

  it('saves unsaved memory as the player after each run and asks the keeper for a checkpoint', async () => {
    const f = makeFixture({ stopAt: 2 });
    await f.supervisor.run();
    expect(f.specs.map((s) => s.file)).toEqual(['sh', 'geldar-git', 'sh', 'geldar-git']);
    const save = f.specs[1];
    expect(save?.args).toEqual([
      'commit',
      '--root',
      f.settings.workspace,
      '--if-changed',
      '--message',
      'session end: unsaved memory',
    ]);
    expect([save?.uid, save?.gid, save?.env.GELDAR_MODE]).toEqual([1000, 1000, 'play']);
    expect(f.read('checkpoint-request')).toBe('{"run":2,"harness":"claude","model":""}\n');
  });

  it('logs a failed save and keeps going', async () => {
    const f = makeFixture({ saveRc: 1, stopAt: 2 });
    expect(await f.supervisor.run()).toBe(0);
    expect(f.runs()).toHaveLength(2);
    expect(f.read('supervisor.log')).toContain('save failed exit=1');
  });
});

describe('the heartbeat', () => {
  it('is written at the start and on every tick, as a UTC timestamp', async () => {
    const f = makeFixture({ stopAt: 1 });
    await f.supervisor.run();
    expect(f.read('heartbeat')).toBe('2026-01-10T23:00:00Z\n');
    expect(f.beats).toHaveLength(1);
    // The idle run after STOP advances the fake clock, so the tick is checked against the clock now.
    const now = f.clock();
    writeFileSync(join(f.stateDir, 'heartbeat'), 'old\n');
    f.beats[0]?.();
    expect(f.read('heartbeat')).toBe(`${new Date(now * 1000).toISOString().slice(0, 19)}Z\n`);
  });
});
