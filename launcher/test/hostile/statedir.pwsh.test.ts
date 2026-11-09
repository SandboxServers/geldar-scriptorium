import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bashPath, childEnv, launchers, makePlayer, makeWorld, repoRoot } from '../harness.ts';
import { assertStatePerms, modeOf } from './world.ts';

// SC-60p (N4): on Linux and macOS the PowerShell launcher keeps <state>/<id> private; only pub/
// (the Squid allowlist) and export/ (the kit, read by the container) are readable. On Windows the
// state sits under LOCALAPPDATA with a user-private ACL, so these cases are skipped there.

const pwsh = launchers.find((l) => l.name === 'pwsh');
const win = process.platform === 'win32';
const T = 240_000;

function runUnder(mask: string, args: string[], env: Record<string, string>) {
  if (!pwsh) throw new Error('no pwsh');
  const r = spawnSync(
    'sh',
    ['-c', 'umask "$0"; exec "$@"', mask, pwsh.command, ...pwsh.prefix, pwsh.entry, ...args],
    { cwd: repoRoot, encoding: 'utf8', timeout: T, env: childEnv(env) },
  );
  return { status: r.status ?? 124, stderr: r.stderr ?? '' };
}

function prepared(mask: string, preSession?: (stateDir: string) => void) {
  const w = makeWorld();
  const p = makePlayer(w, { id: 'abc' });
  // makePlayer (the test's own setup) writes these two; the launcher's `new` makes them private.
  for (const f of ['clone', 'branch']) chmodSync(join(p.stateDir, f), 0o600);
  const sf = join(w.root, 'session.sh');
  writeFileSync(sf, 'exit 0\n');
  const env = { ...w.envPwsh, FAKE_SESSION: bashPath(sf) };
  preSession?.(p.stateDir);
  const a = runUnder(mask, ['__prepare', 'abc', 'play'], env);
  expect(a.status, a.stderr).toBe(0);
  const b = runUnder(mask, ['__session', 'abc', 'play'], env);
  expect(b.status, b.stderr).toBe(0);
  return { w, p };
}

const walk = (dir: string): string[] =>
  (readdirSync(dir, { recursive: true }) as string[]).map((f) => join(dir, String(f)));

describe.skipIf(win || !pwsh)('N4 state permissions (pwsh)', () => {
  it.each(['000', '022'])('under umask %s the state tree is private', { timeout: T }, (mask) => {
    const { w } = prepared(mask);
    expect(assertStatePerms(w.state, 'abc')).toBe('ok');
    expect(modeOf(w.state)).toBe(0o700);
    expect(modeOf(join(w.state, 'abc'))).toBe(0o700);
    expect(modeOf(join(w.state, 'abc', 'session'))).toBe(0o700);
  });

  it('tightens a session directory left 0755 by wave 5', { timeout: T }, () => {
    const { w } = prepared('022', (stateDir) => {
      mkdirSync(join(stateDir, 'session'), { recursive: true });
      chmodSync(join(stateDir, 'session'), 0o755);
    });
    expect(modeOf(join(w.state, 'abc', 'session'))).toBe(0o700);
  });

  it('puts the allowlist in pub/ and nothing else outside pub/ and export/ is readable', {
    timeout: T,
  }, () => {
    const { w } = prepared('022');
    const base = join(w.state, 'abc');
    expect(modeOf(join(base, 'pub', 'allowlist-world.txt'))).toBe(0o644);
    const open = walk(base).filter((p) => {
      const rel = p.slice(base.length + 1).replace(/\\/g, '/');
      return !/^(pub|session\/export)(\/|$)/.test(rel) && (statSync(p).mode & 0o077) !== 0;
    });
    expect(open).toEqual([]);
  });

  it('every file under export/ is readable by other (the container is uid 1000)', {
    timeout: T,
  }, () => {
    const { w } = prepared('000');
    const files = walk(join(w.state, 'abc', 'session', 'export'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(statSync(f).mode & 0o004, f).toBe(0o004);
  });
});
