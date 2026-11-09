import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forGroup, type Launcher, makePlayer, makeWorld, run, type World } from './harness.ts';

// B1: the helper containers run as uid 1000, so they must never be handed the 0700 session
// directory or the 0600 originals. They get a short-lived 0755 directory with a 0644 copy.
const posix = process.platform !== 'win32';

function envOf(l: Launcher, w: World, extra: Record<string, string> = {}) {
  return { ...(l.name === 'bash' ? w.env : w.envPwsh), ...extra };
}

const leftovers = (w: World) => readdirSync(w.state).filter((n) => n.startsWith('stage.'));
const inMounts = (w: World) => {
  const f = join(w.dockerRoot, 'in-mounts.log');
  return existsSync(f)
    ? readFileSync(f, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('\t'))
    : [];
};
const norm = (s: string) => s.replaceAll('\\', '/');

for (const l of forGroup('pre')) {
  describe(`B1 staged helper mounts (${l.name})`, () => {
    it('workspace-init mounts a staged copy, not the session dir, and removes it', () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'stg' });
      const r = run(l, ['__prepare', p.id, 'play'], { env: envOf(l, w), timeoutMs: 120_000 });
      expect(r.status, r.stderr).toBe(0);
      const call = w
        .calls()
        .find((c) => c.includes('geldar.role=workspace-init') && c.includes('-e'));
      const mount = call?.[call.indexOf('-v') + 1] ?? '';
      expect(mount.endsWith(':/in:ro')).toBe(true);
      const src = norm(mount.slice(0, -':/in:ro'.length));
      expect(src).not.toBe(norm(join(p.stateDir, 'session')));
      expect(src).toContain('/stage.');
      expect(leftovers(w)).toEqual([]);
      expect(existsSync(join(p.stateDir, 'session', 'start.bundle'))).toBe(true);
    });

    it.skipIf(!posix)('the mounted dir is 0755 and the file 0644 at the time of the call', () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'stm' });
      const r = run(l, ['__prepare', p.id, 'play'], { env: envOf(l, w), timeoutMs: 120_000 });
      expect(r.status, r.stderr).toBe(0);
      const rows = inMounts(w);
      expect(rows[0]?.[2]).toBe('755');
      expect(rows.find((x) => x[0] === 'file')?.[2]).toBe('644');
      expect(readFileSync(join(w.dockerRoot, 'in-mounts.log'), 'utf8')).toContain('start.bundle');
    });

    it('the staged copy is gone when workspace-init fails', () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'stf' });
      const r = run(l, ['__prepare', p.id, 'play'], {
        env: envOf(l, w, { FAKE_ROLE_FAIL: 'workspace-init' }),
        timeoutMs: 120_000,
      });
      expect(r.status).toBe(1);
      expect(inMounts(w).length).toBeGreaterThan(0);
      expect(leftovers(w)).toEqual([]);
    });
  });
}
