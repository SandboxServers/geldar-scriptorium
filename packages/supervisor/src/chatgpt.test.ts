import { describe, expect, it } from 'vitest';
import { readSettings } from './settings.ts';
import { childEnv, wrapperLine } from './supervisor.ts';

describe('subscription provider dispatch', () => {
  it('defaults to Claude and refuses unknown harnesses', () => {
    expect(wrapperLine(readSettings({}))).toContain('exec claude');
    expect(() => readSettings({ GELDAR_HARNESS: 'unknown' })).toThrow('GELDAR_HARNESS');
  });
  it('runs ChatGPT without inheriting Claude credentials or ambient API keys', () => {
    const settings = readSettings({ GELDAR_HARNESS: 'chatgpt', GELDAR_RUN_MODEL: 'account-model' });
    expect(wrapperLine(settings)).toBe('exec geldar-chatgpt run');
    const env = childEnv(settings, {
      CLAUDE_CODE_OAUTH_TOKEN: 'claude-sentinel',
      OPENAI_API_KEY: 'api-sentinel',
      GH_TOKEN: 'github-sentinel',
      GELDAR_MCP_TOKEN: 'world-token',
    });
    expect(env.GELDAR_MCP_TOKEN).toBe('world-token');
    expect(env.GELDAR_RUN_MODEL).toBe('account-model');
    expect(env.NODE_USE_ENV_PROXY).toBe('1');
    expect(JSON.stringify(env)).not.toContain('sentinel');
  });
});
