import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hooks, mergePacket, pushVerified } from './merge-packet.ts';

const emptyHome = mkdtempSync(join(tmpdir(), 'mp-home-'));
const IDENTITY = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};
const ISOLATION = {
  HOME: emptyHome,
  USERPROFILE: emptyHome,
  XDG_CONFIG_HOME: emptyHome,
  GIT_CONFIG_GLOBAL: join(emptyHome, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
};
const saved: Record<string, string | undefined> = {};

// The tool under test runs plain git with the inherited environment, so the
// hermetic identity and empty config home are set process-wide for this file.
beforeAll(() => {
  for (const [k, v] of Object.entries({ ...ISOLATION, ...IDENTITY })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const g = (cwd: string, ...a: string[]) =>
  execFileSync(
    'git',
    ['-c', 'init.defaultBranch=main', '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a],
    { cwd, encoding: 'utf8', env: { ...process.env, ...ISOLATION, ...IDENTITY } },
  ).trim();

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

  it('reports a non-conflict merge failure as such, not as a conflict', () => {
    const dir = repo();
    packet(dir, 'p1', 'b.txt', 'b\n');
    wave('x.txt'); // diverge so the merge needs a commit (and so an identity)
    const before = g(dir, 'rev-parse', 'HEAD');
    const keep = { ...process.env };
    for (const k of Object.keys(IDENTITY)) delete process.env[k];
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'user.useConfigOnly';
    process.env.GIT_CONFIG_VALUE_0 = 'true';
    try {
      let msg = '';
      try {
        mergePacket(dir, 'p1', hooks());
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/without a conflict/);
      expect(msg).not.toMatch(/merge conflict/);
      expect(msg).toMatch(/ident|user\.|email/i);
    } finally {
      for (const k of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) {
        delete process.env[k];
      }
      Object.assign(process.env, keep);
    }
    expect(g(dir, 'rev-parse', 'HEAD')).toBe(before);
    expect(g(dir, 'status', '--porcelain')).toBe('');

    function wave(file: string) {
      writeFileSync(join(dir, file), 'w\n');
      g(dir, 'add', '.');
      g(dir, 'commit', '-qm', 'wave');
    }
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
