import { describe, expect, it } from 'vitest';
import { readLocalConfig } from './config.ts';

const good = {
  GELDAR_RUN_MODEL: 'local-model',
  GELDAR_LOCAL_BASE_URL: 'http://127.0.0.1:8000/v1',
  GELDAR_LOCAL_CONTEXT_TOKENS: '8192',
  GELDAR_LOCAL_IMAGES: 'false',
};

describe('local settings', () => {
  it('reads a complete set, with the key optional', () => {
    const config = readLocalConfig(good);
    expect(config).toEqual({
      baseUrl: 'http://127.0.0.1:8000/v1',
      model: 'local-model',
      contextTokens: 8192,
      images: false,
    });
    const keyed = readLocalConfig({ ...good, GELDAR_LOCAL_API_KEY: 'key-sentinel' });
    expect(keyed.apiKey).toBe('key-sentinel');
  });

  it('refuses each bad setting by name, never by value', () => {
    const cases: [string, Record<string, string>][] = [
      ['GELDAR_RUN_MODEL', { ...good, GELDAR_RUN_MODEL: '' }],
      ['GELDAR_LOCAL_BASE_URL', { ...good, GELDAR_LOCAL_BASE_URL: 'ftp://url-sentinel' }],
      ['GELDAR_LOCAL_BASE_URL', { ...good, GELDAR_LOCAL_BASE_URL: '' }],
      ['GELDAR_LOCAL_CONTEXT_TOKENS', { ...good, GELDAR_LOCAL_CONTEXT_TOKENS: '10' }],
      ['GELDAR_LOCAL_CONTEXT_TOKENS', { ...good, GELDAR_LOCAL_CONTEXT_TOKENS: '2000001' }],
      ['GELDAR_LOCAL_IMAGES', { ...good, GELDAR_LOCAL_IMAGES: 'yes-sentinel' }],
    ];
    for (const [name, env] of cases) {
      let message = '';
      try {
        readLocalConfig(env);
      } catch (err) {
        message = err instanceof Error ? err.message : '';
      }
      expect(message).toBe(`The setting ${name} is not usable.`);
      expect(message).not.toContain('sentinel');
    }
  });
});
