import { describe, expect, it } from 'vitest';
import { urlCases } from './mcp-url-suite.ts';

// Independent reference for the mcp_url rule (N3). The table must agree with it, so the table
// cannot drift from the stated rule. `.test` stays allowed on purpose: the end-to-end tests use
// world.test and registry.test, and .test never resolves publicly (RFC 6761).
const privateNames = new Set([
  'localhost',
  'host.docker.internal',
  'gateway.docker.internal',
  'kubernetes.docker.internal',
]);
const privateSuffixes = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.lan',
  '.home',
  '.home.arpa',
  '.corp',
  '.intranet',
  '.private',
  '.invalid',
  '.example',
  '.onion',
];

function refUrlOk(url: string): boolean {
  if (!/^https?:\/\/[^/@ ]+\/[A-Za-z0-9._~/-]*$/.test(url)) return false;
  const auth = url.slice(url.indexOf('://') + 3).split('/')[0] ?? '';
  const c = auth.indexOf(':');
  const host = c >= 0 ? auth.slice(0, c) : auth;
  const port = c >= 0 ? auth.slice(c + 1) : '';
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) return false;
  if (!/[a-z]/.test(host.slice(host.lastIndexOf('.') + 1))) return false;
  if (/\/\.\.(\/|$)/.test(url)) return false;
  if (!['', '80', '443'].includes(port)) return false;
  if (host.split('.').some((l) => l === '')) return false;
  if (!host.includes('.')) return false;
  if (privateNames.has(host)) return false;
  if (privateSuffixes.some((s) => host.endsWith(s))) return false;
  return true;
}

describe('mcp-url-cases.json', () => {
  it('has at least 40 rows with both outcomes', () => {
    expect(urlCases.length).toBeGreaterThanOrEqual(40);
    expect(urlCases.some((c) => c.ok)).toBe(true);
    expect(urlCases.some((c) => !c.ok)).toBe(true);
  });

  it('keeps .test allowed and proves xn-- labels are not special', () => {
    expect(urlCases.find((c) => c.url === 'http://world.test/p/x')?.ok).toBe(true);
    expect(urlCases.some((c) => c.ok && c.url.includes('xn--'))).toBe(true);
  });

  it.each(urlCases.map((c) => [c.url, c] as const))('%s agrees with the reference', (_u, c) => {
    expect(refUrlOk(c.url)).toBe(c.ok);
  });
});
