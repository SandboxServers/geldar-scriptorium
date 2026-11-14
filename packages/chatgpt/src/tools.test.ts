import { describe, expect, it } from 'vitest';
import { worldHeaders } from './tools.ts';

describe('worldHeaders', () => {
  it('sends the bearer token and both stamp headers for good values', () => {
    expect(
      worldHeaders({
        GELDAR_MCP_TOKEN: 't0ken',
        GELDAR_HARNESS: 'chatgpt',
        GELDAR_RUN_MODEL: 'gpt-x:1.0/a_b',
      }),
    ).toEqual({
      Authorization: 'Bearer t0ken',
      'X-Geldar-Harness': 'chatgpt',
      'X-Geldar-Model': 'gpt-x:1.0/a_b',
    });
  });

  it('omits a stamp header whose value has a space or is over 64 characters', () => {
    const headers = worldHeaders({
      GELDAR_MCP_TOKEN: 't0ken',
      GELDAR_HARNESS: 'local',
      GELDAR_RUN_MODEL: 'a b',
    });
    expect(headers).toEqual({ Authorization: 'Bearer t0ken', 'X-Geldar-Harness': 'local' });
    const long = worldHeaders({ GELDAR_MCP_TOKEN: 't0ken', GELDAR_RUN_MODEL: 'm'.repeat(65) });
    expect(long).not.toHaveProperty('X-Geldar-Model');
    expect(
      worldHeaders({ GELDAR_MCP_TOKEN: 't0ken', GELDAR_RUN_MODEL: 'm'.repeat(64) }),
    ).toHaveProperty('X-Geldar-Model');
  });

  it('sends no harness header for a value that is not a harness name', () => {
    expect(worldHeaders({ GELDAR_HARNESS: 'other' })).not.toHaveProperty('X-Geldar-Harness');
    expect(worldHeaders({})).toEqual({ Authorization: 'Bearer ' });
  });

  it('never puts the Authorization value in another header', () => {
    const headers = worldHeaders({
      GELDAR_MCP_TOKEN: 'secret-token',
      GELDAR_HARNESS: 'claude',
      GELDAR_RUN_MODEL: 'm1',
    });
    const { Authorization, ...others } = headers;
    expect(Authorization).toBe('Bearer secret-token');
    expect(Object.values(others).join('\n')).not.toContain('secret-token');
  });
});
