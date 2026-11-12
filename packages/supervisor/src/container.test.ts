import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeFixture } from './fixture.ts';
import { HELD_REASON, wrapperLine } from './supervisor.ts';

describe('the keeper HELD marker', () => {
  it('refuses to start while HELD is present', async () => {
    const f = makeFixture();
    writeFileSync(join(f.keeperDir, 'HELD'), 'rejected\n');
    expect(await f.supervisor.run()).toBe(1);
    expect(f.runs()).toHaveLength(0);
    expect(f.read('STOP')).toBe(`auto: ${HELD_REASON}\n`);
    expect(f.has('lock')).toBe(false);
  });

  it('stops between runs when HELD appears, and plays no more', async () => {
    const f = makeFixture({ heldAt: 1 });
    expect(await f.supervisor.run()).toBe(1);
    expect(f.runs()).toHaveLength(1);
    expect(f.read('STOP')).toBe(`auto: ${HELD_REASON}\n`);
    expect(f.sleeps).toEqual([]);
    expect(f.read('status.json')).toMatch(/"state":"stopped"/);
  });

  it('stops before the next run when HELD appears while waiting', async () => {
    const f = makeFixture();
    let waits = 0;
    f.deps.sleep = async () => {
      writeFileSync(join(f.keeperDir, 'HELD'), 'rejected\n');
      // A safety net so a broken loop fails the assertions instead of running on.
      if (++waits > 3) writeFileSync(join(f.stateDir, 'STOP'), 'x\n');
    };
    expect(await f.supervisor.run()).toBe(1);
    expect(f.runs()).toHaveLength(1);
    expect(f.read('STOP')).toMatch(/^auto: the keeper held/);
  });
});

describe('the child process', () => {
  const secret = 'sk-ant-oat01-SECRET-VALUE';
  const mcp = 'mcp-SECRET-VALUE';

  it('runs as the player with an explicit environment and no prompt in its arguments', async () => {
    const f = makeFixture(
      { stopAt: 1, last: 'hello' },
      { GELDAR_PLAYER_UID: '1234', GELDAR_PLAYER_GID: '4321', GELDAR_RUN_MODEL: 'opus' },
      { CLAUDE_CODE_OAUTH_TOKEN: secret, GELDAR_MCP_TOKEN: mcp, HTTPS_PROXY: 'http://proxy:3128' },
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
      GELDAR_RUN_MAX_TURNS: '300',
      GELDAR_RUN_MODEL: 'opus',
      CLAUDE_CODE_OAUTH_TOKEN: secret,
      GELDAR_MCP_TOKEN: mcp,
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
    expect(f.read('checkpoint-request')).toBe('2\n');
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
    writeFileSync(join(f.stateDir, 'heartbeat'), 'old\n');
    f.beats[0]?.();
    expect(f.read('heartbeat')).toBe('2026-01-10T23:01:00Z\n');
  });
});
