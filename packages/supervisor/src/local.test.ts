import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeFixture } from './fixture.ts';
import { readSettings } from './settings.ts';
import { childEnv, wrapperLine } from './supervisor.ts';

const local = {
  GELDAR_HARNESS: 'local',
  GELDAR_RUN_MODEL: 'local-model',
  GELDAR_LOCAL_BASE_URL: 'http://127.0.0.1:8000/v1',
  GELDAR_LOCAL_CONTEXT_TOKENS: '8192',
  GELDAR_LOCAL_IMAGES: 'false',
};

describe('the local harness', () => {
  it('runs geldar-local run', () => {
    expect(wrapperLine(readSettings(local))).toBe('exec geldar-local run');
  });

  it('gives the child the local settings and the proxy flag, and no subscription or API keys', () => {
    const settings = readSettings({ ...local, GELDAR_LOCAL_API_KEY: 'key-sentinel' });
    const env = childEnv(settings, {
      CLAUDE_CODE_OAUTH_TOKEN: 'claude-sentinel',
      OPENAI_API_KEY: 'api-sentinel',
      GH_TOKEN: 'github-sentinel',
      GELDAR_LOCAL_API_KEY: 'key-sentinel',
    });
    expect(env.GELDAR_LOCAL_BASE_URL).toBe('http://127.0.0.1:8000/v1');
    expect(env.GELDAR_LOCAL_CONTEXT_TOKENS).toBe('8192');
    expect(env.GELDAR_LOCAL_IMAGES).toBe('false');
    expect(env.GELDAR_LOCAL_API_KEY).toBe('key-sentinel');
    expect(env.NODE_USE_ENV_PROXY).toBe('1');
    expect(env.GELDAR_RUN_MODEL).toBe('local-model');
    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('GH_TOKEN');
  });

  it('passes no GELDAR_LOCAL name to the Claude harness, even when the parent has the key', () => {
    const settings = readSettings({ GELDAR_HARNESS: 'claude' });
    const env = childEnv(settings, { GELDAR_LOCAL_API_KEY: 'key-sentinel' });
    expect(Object.keys(env).filter((name) => name.startsWith('GELDAR_LOCAL_'))).toEqual([]);
  });

  it('refuses a local run without a usable setting, naming the variable and not its value', () => {
    expect(() => readSettings({ ...local, GELDAR_RUN_MODEL: '' })).toThrow('GELDAR_RUN_MODEL');
    expect(() => readSettings({ ...local, GELDAR_LOCAL_BASE_URL: 'ftp://x' })).toThrow(
      'GELDAR_LOCAL_BASE_URL',
    );
    expect(() => readSettings({ ...local, GELDAR_LOCAL_CONTEXT_TOKENS: '10' })).toThrow(
      'GELDAR_LOCAL_CONTEXT_TOKENS',
    );
    expect(() => readSettings({ ...local, GELDAR_LOCAL_CONTEXT_TOKENS: undefined })).toThrow(
      'GELDAR_LOCAL_CONTEXT_TOKENS',
    );
    expect(() => readSettings({ ...local, GELDAR_LOCAL_IMAGES: 'maybe' })).toThrow(
      'GELDAR_LOCAL_IMAGES',
    );
  });

  it('keeps the key out of the settings object', () => {
    const settings = readSettings({ ...local, GELDAR_LOCAL_API_KEY: 'key-sentinel' });
    expect(JSON.stringify(settings)).not.toContain('key-sentinel');
  });

  it('starts no tidy session for a local run over the journal limit', async () => {
    const f = makeFixture(
      { tools: 3 },
      { ...local, GELDAR_TIDY_BYTES: '1000', GELDAR_RUN_MAX_FAILS: '99' },
    );
    // A journal well over the limit: the Claude harness would tidy first.
    const dir = join(f.root, 'ws/memory/journal');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'current.md'), `# Journal\n${'x'.repeat(5000)}`);
    const args: string[] = [];
    const real = f.deps.exec;
    f.deps.exec = async (spec) => {
      args.push(spec.args.join(' '));
      return real(spec);
    };
    await f.supervisor.run();
    expect(args.some((line) => line.includes('geldar-local run'))).toBe(true);
    expect(args.some((line) => line.includes('tidy.json'))).toBe(false);
  });
});
