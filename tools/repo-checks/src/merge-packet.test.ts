import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Hooks, mergePacket, pushVerified } from './merge-packet.ts';

const g = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], {
    cwd,
    encoding: 'utf8',
  }).trim();

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mp-'));
  g(dir, 'init', '-q', '-b', 'scriptorium/wave9');
  writeFileSync(join(dir, 'a.txt'), 'base\n');
  g(dir, 'add', '.');
  g(dir, 'commit', '-qm', 'base');
  return dir;
}

function packet(dir: string, name: string, file: string, text: string): void {
  g(dir, 'checkout', '-q', '-b', name);
  writeFileSync(join(dir, file), text);
  g(dir, 'add', '.');
  g(dir, 'commit', '-qm', name);
  g(dir, 'checkout', '-q', 'scriptorium/wave9');
}

const hooks = (over: Partial<Hooks> = {}): Hooks => ({
  runCheck: () => true,
  runInstall: () => true,
  log: () => {},
  ...over,
});

describe('mergePacket', () => {
  it('merges with --no-ff and runs the check', () => {
    const dir = repo();
    packet(dir, 'p1', 'b.txt', 'b\n');
    let checked = 0;
    mergePacket(dir, 'p1', hooks({ runCheck: () => (checked++, true) }));
    expect(checked).toBe(1);
    expect(g(dir, 'rev-list', '--parents', '-1', 'HEAD').split(' ')).toHaveLength(3);
  });

  it('refuses a non-wave branch and a dirty tree', () => {
    const dir = repo();
    packet(dir, 'p1', 'b.txt', 'b\n');
    writeFileSync(join(dir, 'a.txt'), 'dirty\n');
    expect(() => mergePacket(dir, 'p1', hooks())).toThrow(/not clean/);
    g(dir, 'checkout', '-q', '--', 'a.txt');
    g(dir, 'checkout', '-q', 'p1');
    expect(() => mergePacket(dir, 'p1', hooks())).toThrow(/not a wave branch/);
  });

  it('refuses a branch name that starts with a dash', () => {
    const dir = repo();
    g(dir, 'update-ref', 'refs/heads/-x', 'HEAD');
    expect(() => mergePacket(dir, '-x', hooks())).toThrow(/starts with '-'/);
  });

  it('reverts the merge and throws when the check fails', () => {
    const dir = repo();
    packet(dir, 'p1', 'b.txt', 'b\n');
    const before = g(dir, 'rev-parse', 'HEAD');
    expect(() => mergePacket(dir, 'p1', hooks({ runCheck: () => false }))).toThrow(/check failed/);
    expect(g(dir, 'rev-parse', 'HEAD')).toBe(before);
  });

  it('aborts on a conflict in any file but the lockfile', () => {
    const dir = repo();
    packet(dir, 'p1', 'a.txt', 'one\n');
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    g(dir, 'commit', '-qam', 'wave edit');
    expect(() => mergePacket(dir, 'p1', hooks())).toThrow(/a\.txt/);
    expect(g(dir, 'status', '--porcelain')).toBe('');
  });

  it('keeps the wave lockfile on a lockfile conflict and regenerates it', () => {
    const dir = repo();
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'base\n');
    g(dir, 'add', '.');
    g(dir, 'commit', '-qm', 'lock');
    packet(dir, 'p1', 'pnpm-lock.yaml', 'packet\n');
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'wave\n');
    g(dir, 'commit', '-qam', 'wave lock');
    let installed = 0;
    mergePacket(dir, 'p1', hooks({ runInstall: () => (installed++, true) }));
    expect(installed).toBe(1);
    expect(g(dir, 'show', 'HEAD:pnpm-lock.yaml')).toBe('wave');
  });
});

describe('pushVerified', () => {
  function withRemote(): string {
    const dir = repo();
    const bare = mkdtempSync(join(tmpdir(), 'bare-'));
    g(bare, 'init', '-q', '--bare');
    g(dir, 'remote', 'add', 'origin', bare);
    return dir;
  }

  it('pushes the named branch and verifies the remote tip', () => {
    const dir = withRemote();
    expect(pushVerified(dir)).toBe(g(dir, 'rev-parse', 'HEAD'));
  });

  it('fails loudly when the push did nothing', () => {
    const dir = withRemote();
    expect(() => pushVerified(dir, () => {})).toThrow(/NOT verified/);
  });
});
