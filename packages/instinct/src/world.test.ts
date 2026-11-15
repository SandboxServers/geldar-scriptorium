import { describe, expect, it } from 'vitest';
import { connectWorld, worldHeaders } from './world.ts';

describe('worldHeaders (same rules as mind-loop worldHeaders)', () => {
  it('sends the bearer token, the harness and the model when they are valid', () => {
    expect(
      worldHeaders({
        GELDAR_MCP_TOKEN: 'tok',
        GELDAR_HARNESS: 'claude',
        GELDAR_RUN_MODEL: 'claude-haiku-5-5',
      }),
    ).toEqual({
      Authorization: 'Bearer tok',
      'X-Geldar-Harness': 'claude',
      'X-Geldar-Model': 'claude-haiku-5-5',
    });
  });

  it('leaves out an unknown harness and a model with a space in it', () => {
    expect(
      worldHeaders({ GELDAR_MCP_TOKEN: 't', GELDAR_HARNESS: 'evil', GELDAR_RUN_MODEL: 'a b' }),
    ).toEqual({ Authorization: 'Bearer t' });
  });

  it('a missing token is an empty bearer', () => {
    expect(worldHeaders({})).toEqual({ Authorization: 'Bearer ' });
  });

  it('keeps a 64-character model and leaves out a 65-character one', () => {
    expect(worldHeaders({ GELDAR_RUN_MODEL: 'x'.repeat(64) })['X-Geldar-Model']).toBe(
      'x'.repeat(64),
    );
    expect(worldHeaders({ GELDAR_RUN_MODEL: 'x'.repeat(65) })).not.toHaveProperty('X-Geldar-Model');
  });
});

describe('connectWorld refuses a bad address before any connect', () => {
  it('a non-http address is refused', async () => {
    await expect(connectWorld({ GELDAR_MCP_URL: 'ftp://127.0.0.1/p/x' })).rejects.toThrow(
      'world address',
    );
  });

  it('credentials in the address are refused', async () => {
    await expect(
      connectWorld({ GELDAR_MCP_URL: 'http://user:pw@127.0.0.1:8080/p/x' }),
    ).rejects.toThrow('world address');
  });

  it('a missing address is refused', async () => {
    await expect(connectWorld({})).rejects.toThrow();
  });
});
