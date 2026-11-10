import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dockerReady, repoRoot, run, SQUID_IMAGE } from './docker.ts';

const ready = dockerReady();
const confPath = resolve(repoRoot, 'image/proxy/squid.conf');
const vendorPath = resolve(repoRoot, 'image/proxy/allowlist-vendor.txt');
const conf = readFileSync(confPath, 'utf8');
const vendor = readFileSync(vendorPath, 'utf8');
const defaultPortsPath = resolve(repoRoot, 'image/proxy/world-ports-default.txt');

// Non-blank, non-comment lines of a Squid config or an allowlist.
function activeLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

// Policy violations of a Squid config; an empty list means the policy holds.
function policyProblems(text: string): string[] {
  const problems: string[] = [];
  const lines = activeLines(text);
  const access = lines.filter((line) => line.startsWith('http_access'));
  if (access.at(-1) !== 'http_access deny all') {
    problems.push('the last http_access line is not "http_access deny all"');
  }
  const denyAll = access.indexOf('http_access deny all');
  if (denyAll !== -1 && access.slice(denyAll + 1).some((l) => /^http_access\s+allow\b/.test(l))) {
    problems.push('an http_access allow line follows "deny all"');
  }
  for (const line of lines) {
    if (/\ballow\s+(all|localnet|localhost)\b/.test(line)) {
      problems.push(`forbidden rule: ${line}`);
    }
  }
  return problems;
}

// Problems with an allowlist file; an empty list means it is exact hosts only.
function vendorProblems(text: string): string[] {
  const problems: string[] = [];
  for (const line of activeLines(text)) {
    if (line.startsWith('.') || line.startsWith('*')) problems.push(`wildcard entry: ${line}`);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(line)) problems.push(`IP literal entry: ${line}`);
  }
  if (!activeLines(text).includes('api.anthropic.com')) {
    problems.push('api.anthropic.com is missing');
  }
  return problems;
}

describe('squid policy (structure)', () => {
  it('the shipped config passes every policy rule', () => {
    expect(policyProblems(conf)).toEqual([]);
  }, 120_000);

  it('the last http_access line is "http_access deny all" and no allow follows it', () => {
    const access = activeLines(conf).filter((line) => line.startsWith('http_access'));
    expect(access.at(-1)).toBe('http_access deny all');
    const denyAll = access.indexOf('http_access deny all');
    expect(access.slice(denyAll + 1).filter((l) => l.startsWith('http_access allow'))).toEqual([]);
  }, 120_000);

  it('there is no "allow all", "allow localnet" or "allow localhost" rule anywhere', () => {
    expect(conf).not.toMatch(/^[^#\n]*\ballow\s+(all|localnet|localhost)\b/m);
  }, 120_000);

  it('the vendor allowlist has exact hosts only and contains api.anthropic.com', () => {
    expect(vendorProblems(vendor)).toEqual([]);
  }, 120_000);

  it('a config that allows all before deny all is rejected by the same checker', () => {
    const variant = conf.replace(
      'http_access deny all',
      'http_access allow all\nhttp_access deny all',
    );
    expect(policyProblems(variant).length).toBeGreaterThan(0);
  }, 120_000);

  it('a vendor list with a wildcard, an IP literal or no api.anthropic.com is rejected', () => {
    expect(vendorProblems(`${vendor}.anthropic.com\n`).length).toBeGreaterThan(0);
    expect(vendorProblems(`${vendor}192.0.2.1\n`).length).toBeGreaterThan(0);
    expect(vendorProblems('claude.ai\n').length).toBeGreaterThan(0);
  }, 120_000);

  it('the world port rule is in place, in order, and no Safe_ports line was widened', () => {
    const lines = activeLines(conf);
    expect(lines).toContain('acl world_port port "/etc/squid/allowlist-world-ports.txt"');
    expect(lines).toContain('acl port_80 port 80');
    expect(lines.filter((l) => l.startsWith('acl Safe_ports'))).toEqual([
      'acl Safe_ports port 80',
      'acl Safe_ports port 443',
    ]);
    expect(lines.filter((l) => l.startsWith('http_access'))).toEqual([
      'http_access deny !Safe_ports !world_port',
      'http_access deny CONNECT port_80',
      'http_access deny CONNECT !SSL_ports !world_port',
      'http_access allow allowed_vendor Safe_ports',
      'http_access allow allowed_world world_port',
      'http_access deny all',
    ]);
    expect(lines).not.toContain('http_access allow allowed_world Safe_ports');
  }, 120_000);

  it('the default world ports file is exactly 443', () => {
    expect(readFileSync(defaultPortsPath, 'utf8')).toBe('443\n');
  }, 120_000);
  it('SQUID_IMAGE is pinned by digest', () => {
    expect(SQUID_IMAGE).toMatch(/^ubuntu\/squid(:[^@]+)?@sha256:[0-9a-f]{64}$/);
  }, 120_000);
});

describe.skipIf(!ready)('squid policy (Squid parses the shipped config)', () => {
  let tempDir = '';
  let emptyWorld = '';

  beforeAll(() => {
    // Pull once so the parse runs stay inside their 60 s budget on a cold runner.
    const pulled = run(['pull', SQUID_IMAGE], { timeoutMs: 600000 });
    expect(pulled.status, pulled.stderr).toBe(0);
    // Squid reads these files under cap_drop: ALL, so they need 0644 and their directory 0755.
    tempDir = mkdtempSync(join(tmpdir(), 'geldar-squid-'));
    chmodSync(tempDir, 0o755);
    emptyWorld = join(tempDir, 'allowlist-world.txt');
    writeFileSync(emptyWorld, '');
    chmodSync(emptyWorld, 0o644);
  }, 900_000);

  afterAll(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }, 120_000);

  it('squid -k parse exits 0 for the shipped config', () => {
    const result = run(
      [
        'run',
        '--rm',
        '-v',
        `${confPath}:/etc/squid/squid.conf:ro`,
        '-v',
        `${vendorPath}:/etc/squid/allowlist-vendor.txt:ro`,
        '-v',
        `${emptyWorld}:/etc/squid/allowlist-world.txt:ro`,
        '-v',
        `${defaultPortsPath}:/etc/squid/allowlist-world-ports.txt:ro`,
        '--entrypoint',
        'squid',
        SQUID_IMAGE,
        '-k',
        'parse',
      ],
      { timeoutMs: 60000 },
    );
    expect(result.status, result.stderr).toBe(0);
  }, 120_000);
});
