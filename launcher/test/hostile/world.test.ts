import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forGroup } from '../harness.ts';
import {
  assertStatePerms,
  attack,
  benign,
  expectHostUnchanged,
  expectNoDockerCall,
  expectRefusal,
} from './world.ts';

const T = 60_000;
const win = process.platform === 'win32';

describe.each(forGroup('hostile'))('hostile harness ($name)', (launcher) => {
  it('1. benign control ends saved with only a fast-forward', { timeout: T }, () => {
    const a = attack(launcher, { session: benign });
    expect(a.finish.status, a.finish.stderr).toBe(0);
    expect(a.ran).toBe(true);
    expectHostUnchanged(a.before, a.after, { advancedBranch: true });
  });

  it('2. a session that never reaches its mark is vacuous', { timeout: T }, () => {
    expect(() => attack(launcher, { session: 'exit 7' })).toThrow('vacuous attack');
  });

  it('3a. a write into the host clone is detected', { timeout: T }, () => {
    const a = attack(launcher, { session: 'echo x > "$HOST_CLONE/stray.txt"' });
    expect(() => expectHostUnchanged(a.before, a.after)).toThrow('status');
  });

  it('3b. an edit of a canary file is detected', { timeout: T }, () => {
    const b = attack(launcher, { session: 'echo changed > "$HOST_CLONE/../../canary/notes.txt"' });
    expect(() => expectHostUnchanged(b.before, b.after)).toThrow('canary');
  });

  it('4. expectRefusal rejects a wrong key and an ESC byte', () => {
    const ok = {
      status: 1,
      stderr: 'geldar-play: The branch name for x is not allowed.',
      stdout: '',
    };
    expect(() => expectRefusal(ok, 'bad_branch', { status: 1 })).not.toThrow();
    expect(() => expectRefusal(ok, 'export_symlink', { status: 1 })).toThrow();
    expect(() => expectRefusal(ok, 'no_such_key_anywhere', { status: 1 })).toThrow('not found');
    const esc = { ...ok, stderr: `${ok.stderr}${String.fromCharCode(27)}[31m` };
    expect(() => expectRefusal(esc, 'bad_branch', { status: 1 })).toThrow();
  });

  it('6. expectNoDockerCall passes a refused launch and fails the benign one', {
    timeout: T,
  }, () => {
    const a = attack(launcher, {
      session: benign,
      expectRun: false,
      setup: (_w, p) => writeFileSync(join(p.clone, 'dirty.txt'), 'dirty\n'),
    });
    expect(a.prepare.status).not.toBe(0);
    expectNoDockerCall(a.world);
    const b = attack(launcher, { session: benign });
    expect(() => expectNoDockerCall(b.world)).toThrow();
  });

  it('7. allowlistPath names a file that existed during the session', { timeout: T }, () => {
    const a = attack(launcher, { session: benign });
    expect(a.allowlistPath).not.toBe('');
    expect(a.allowlistSeen, a.allowlistPath).toBe(true);
  });
});

describe('hostile harness: state permissions', () => {
  const tree = (spec: Record<string, number>) => {
    const root = mkdtempSync(join(tmpdir(), 'gp-perm-'));
    for (const [rel, mode] of Object.entries(spec)) {
      const p = join(root, 'abc', rel);
      if (rel.endsWith('/')) {
        mkdirSync(p, { recursive: true });
      } else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, 'x');
      }
      chmodSync(p, mode);
    }
    return root;
  };
  it.skipIf(win)('5. rejects 0755 session and 0600 export file, accepts the good tree', () => {
    const good = tree({
      'pub/': 0o755,
      'pub/allowlist-world.txt': 0o644,
      'session/': 0o700,
      'session/f': 0o600,
      'export/': 0o755,
      'export/d/': 0o755,
      'export/d/f': 0o644,
    });
    expect(assertStatePerms(good, 'abc')).toBe('ok');
    const bad1 = tree({ 'session/': 0o755, 'session/f': 0o600 });
    expect(() => assertStatePerms(bad1, 'abc')).toThrow('session');
    const bad2 = tree({ 'export/': 0o755, 'export/f': 0o600 });
    expect(() => assertStatePerms(bad2, 'abc')).toThrow('export');
  });
  it.runIf(win)('5. skipped on win32: the state lives under a user-private ACL path', () => {
    expect(assertStatePerms('unused', 'abc')).toBe('skipped');
  });
});
