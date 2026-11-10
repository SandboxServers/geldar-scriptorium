import { describe, expect, it } from 'vitest';
import { devWorldCases } from './devworld-suite.ts';

// Independent reference for rule 2 of the dev-world seam: exactly this shape, port 1024 to
// 65535 without a leading zero, and the path names the player being started.
function refOk(value: string, player: string): boolean {
  const m = /^http:\/\/host\.docker\.internal:([1-9][0-9]{0,4})\/p\/([a-z0-9-]+)$/.exec(value);
  if (!m) return false;
  const port = Number(m[1]);
  return port >= 1024 && port <= 65535 && m[2] === player;
}

describe('devworld-cases.json', () => {
  it('has both outcomes and every row has the three fields', () => {
    expect(devWorldCases.length).toBeGreaterThanOrEqual(30);
    expect(devWorldCases.some((c) => c.ok)).toBe(true);
    expect(devWorldCases.some((c) => !c.ok)).toBe(true);
    for (const c of devWorldCases) {
      expect(typeof c.value).toBe('string');
      expect(typeof c.player).toBe('string');
      expect(typeof c.ok).toBe('boolean');
    }
  });

  it('holds the exact good URL and the boundary ports', () => {
    const good = (v: string) => devWorldCases.find((c) => c.value === v)?.ok;
    expect(good('http://host.docker.internal:8787/p/<id>')).toBe(true);
    expect(good('http://host.docker.internal:1023/p/<id>')).toBe(false);
    expect(good('http://host.docker.internal:65536/p/<id>')).toBe(false);
  });

  it.each(devWorldCases.map((c) => [JSON.stringify(c.value), c] as const))(
    '%s agrees with the reference',
    (_v, c) => {
      expect(refOk(c.value.replaceAll('<id>', c.player), c.player)).toBe(c.ok);
    },
  );
});
