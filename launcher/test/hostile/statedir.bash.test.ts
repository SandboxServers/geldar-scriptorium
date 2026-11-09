import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Launcher, launchers } from '../harness.ts';
import { assertStatePerms, attack, benign, modeOf } from './world.ts';

// SC-60o (review N4): the state is private; only pub/allowlist-world.txt and export/ are readable.
// Permission bits are POSIX-only: unverified on win32, CI decides.
const bash = launchers.find((l) => l.name === 'bash');
const posix = process.platform !== 'win32';
const T = 120_000;

// The same launcher started under a given umask in the caller's environment.
const under = (l: Launcher, mask: string): Launcher => ({
  ...l,
  command: 'sh',
  prefix: ['-c', `umask ${mask}; exec "$0" "$@"`, l.command, ...l.prefix],
});

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? [join(dir, e.name), ...walk(join(dir, e.name))] : [join(dir, e.name)],
  );

describe.skipIf(!bash || !posix)('N4 state permissions (bash; skipped on win32)', () => {
  const l = bash as Launcher;

  for (const mask of ['000', '022']) {
    it(`umask ${mask}: prepare and session leave a private tree`, { timeout: T }, () => {
      const a = attack(under(l, mask), { session: benign, until: 'verify' });
      expect(a.prepare.status, a.prepare.stderr).toBe(0);
      expect(assertStatePerms(a.world.state, 'abc')).toBe('ok');
      expect(modeOf(a.world.state) & 0o077).toBe(0);
      expect(modeOf(join(a.world.state, 'abc', 'session'))).toBe(0o700);
    });
  }

  it('the allowlist is the only public file and no private file leaks', { timeout: T }, () => {
    const a = attack(under(l, '000'), { session: benign, until: 'verify' });
    expect(a.allowlistPath.endsWith('pub/allowlist-world.txt')).toBe(true);
    expect(a.allowlistSeen).toBe(true);
    const base = join(a.world.state, 'abc');
    for (const p of walk(base)) {
      const rel = relative(base, p).replaceAll('\\', '/');
      if (rel === 'pub' || rel === 'pub/allowlist-world.txt' || rel.startsWith('session/export')) continue;
      expect(modeOf(p) & 0o077, rel).toBe(0);
    }
    expect(existsSync(join(base, 'token'))).toBe(false);
  });

  it('a session dir left 0755 by the old layout is tightened', { timeout: T }, () => {
    const a = attack(l, {
      session: benign,
      until: 'verify',
      setup: (w) => {
        const sd = join(w.state, 'abc', 'session');
        mkdirSync(sd, { recursive: true });
        chmodSync(sd, 0o755);
        writeFileSync(join(sd, 'old.txt'), 'x');
      },
    });
    expect(modeOf(join(a.world.state, 'abc', 'session'))).toBe(0o700);
  });

  it('every file under export/ is world readable (container uid 1000)', { timeout: T }, () => {
    const a = attack(under(l, '077'), { session: benign, until: 'verify' });
    const ex = join(a.world.state, 'abc', 'session', 'export');
    const files = walk(ex).filter((p) => statSync(p).isFile());
    expect(files.length).toBeGreaterThan(0);
    for (const p of files) expect(modeOf(p) & 0o004, p).toBe(0o004);
  });
});
