import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchers } from './harness.ts';
import { canQuote, expectClean, ID, setup, T, vol } from './player-support.ts';

// SC-167c: geldar-play sync <id> asks the keeper to fetch upstream now, and player-status shows the
// upstream result of the keeper and the supervisor. Both launchers. The docker stand-in prints the
// running services from compose-ps.txt (see player-support.ts). That file holds what the real
// `docker compose ps --status running --format '{{.Service}}'` prints: one compose service name per
// line, as image/compose/player.yml names them (the supervisor is a user inside the `player` service).

const REAL_RUNNING = ['keeper', 'player', 'proxy-keeper', 'proxy-player'];

const running = (w: { dockerRoot: string }, names: string[] = REAL_RUNNING) =>
  writeFileSync(join(w.dockerRoot, 'compose-ps.txt'), `${names.join('\n')}\n`);

for (const l of launchers) {
  describe(`${l.name} sync`, () => {
    it('sync when the player is not running refuses with the message and asks nobody', {
      timeout: T,
    }, () => {
      const s = setup(l);
      const r = s.go('sync', ID);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`${ID} is not running, so there is nothing to sync`);
      expect(s.w.calls().filter((c) => c.join(' ').includes('sync-request'))).toEqual([]);
      expect(existsSync(join(vol(s.w, `geldar-keep-${ID}`), 'sync-request'))).toBe(false);
      expectClean(s.w, r);
    });

    it('sync refuses when the keeper is not running, though the player is', { timeout: T }, () => {
      const s = setup(l);
      running(s.w, ['player', 'proxy-player', 'proxy-keeper']);
      const r = s.go('sync', ID);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`${ID} is not running, so there is nothing to sync`);
      expect(s.w.calls().filter((c) => c.join(' ').includes('sync-request'))).toEqual([]);
      expectClean(s.w, r);
    });

    it('sync refuses when the player is not running, though the keeper is', { timeout: T }, () => {
      const s = setup(l);
      running(s.w, ['keeper', 'proxy-keeper']);
      const r = s.go('sync', ID);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`${ID} is not running, so there is nothing to sync`);
      expect(s.w.calls().filter((c) => c.join(' ').includes('sync-request'))).toEqual([]);
      expectClean(s.w, r);
    });

    it('sync when running creates sync-request in the keeper state through a helper container', {
      timeout: T,
    }, () => {
      const s = setup(l);
      running(s.w);
      const r = s.go('sync', ID);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toContain(`A sync is requested for ${ID}`);
      expect(r.stderr).toContain('between runs');
      // One helper container, with the keeper state mounted read-write and the touch as its script.
      const helpers = s.w
        .calls()
        .filter((c) => c[0] === 'run' && c.join(' ').includes('touch /vol/sync-request'));
      expect(helpers).toHaveLength(1);
      expect(helpers[0]?.join(' ')).toContain(`geldar-keep-${ID}:/vol:rw`);
      expect(existsSync(join(vol(s.w, `geldar-keep-${ID}`), 'sync-request'))).toBe(true);
      expectClean(s.w, r);
    });

    it('player-status shows the upstream result of the keeper and of the supervisor', (ctx) => {
      if (!canQuote(l)) {
        console.info(
          `player-status upstream (${l.name}): skipped, the .cmd shims refuse a double quote`,
        );
        ctx.skip();
      }
      const s = setup(l);
      writeFileSync(
        join(vol(s.w, `geldar-keep-${ID}`), 'status.json'),
        '{\n  "upstream_head": "9a8b7c6",\n  "upstream_result": "fast-forward"\n}\n',
      );
      writeFileSync(
        join(vol(s.w, `geldar-sup-${ID}`), 'status.json'),
        '{\n  "state": "running",\n  "upstream_head": "9a8b7c6",\n  "upstream_result": "held"\n}\n',
      );
      const r = s.go('player-status', ID);
      expect(r.status, r.stderr).toBe(0);
      // The keeper's grep and the supervisor's status.json both carry the upstream keys.
      expect(r.stdout).toContain('"upstream_result": "fast-forward"');
      expect(r.stdout).toContain('"upstream_head": "9a8b7c6"');
      expect(r.stdout).toContain('"upstream_result": "held"');
      expectClean(s.w, r);
    });
  });
}
