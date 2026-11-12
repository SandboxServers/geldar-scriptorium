import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bashPath, launchers } from './harness.ts';
import {
  canQuote,
  composeCalls,
  composeEnvs,
  expectClean,
  GITHUB,
  ID,
  KEY,
  LOGIN,
  MCP,
  playerYml,
  REMOTE,
  setup,
  T,
  vol,
} from './player-support.ts';

// SC-163a part 2 and SC-163b part 2: the persistent player verbs (decision 64), under both launchers.
// Each test runs once per launcher; the player-status tests need a double quote in a docker argument,
// which the .cmd shims on Windows refuse, so pwsh there skips them visibly.

for (const l of launchers) {
  describe(l.name, () => {
    it('start refuses without a deploy key, a token file or a usable login', { timeout: T }, () => {
      const cases: [Parameters<typeof setup>[1], string][] = [
        [{ key: false }, 'has no deploy key yet'],
        [{ token: false }, 'has no MCP token file'],
        [{ login: false }, 'There is no shared Claude login stored'],
        [{ login: 'too-short' }, 'There is no shared Claude login stored'],
      ];
      for (const [opts, text] of cases) {
        const s = setup(l, opts);
        const r = s.go('start', ID);
        expect(r.status, text).toBe(1);
        expect(r.stderr).toContain(text);
        expect(composeCalls(s.w, 'up')).toEqual([]);
        expect(s.w.calls().filter((c) => c[0] === 'run')).toEqual([]);
      }
    });

    it('start refuses when origin is not github.com', { timeout: T }, () => {
      const s = setup(l, { origin: 'https://example.com/acme/player-one.git' });
      const r = s.go('start', ID);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('not a GitHub repository');
      expect(composeCalls(s.w, 'up')).toEqual([]);
    });

    it('start with every check met runs compose up -d with the key file path, not its text', {
      timeout: T,
    }, () => {
      const s = setup(l);
      const r = s.go('start', ID);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toContain(`${ID} is started`);
      // pl_compose builds -p before -f: the order the launcher uses.
      expect(composeCalls(s.w, 'up')).toEqual([
        ['compose', '-p', `geldar-player-${ID}`, '-f', playerYml(l), 'up', '-d'],
      ]);
      const [env] = composeEnvs(s.w);
      expect(env?.GELDAR_KEEPER_REMOTE).toBe(REMOTE);
      // pwsh joins a native folder with "/deploy-key", so its separators differ: compare them as slashes.
      const keyFile = join(s.p.stateDir, 'deploy-key');
      expect(env?.GELDAR_DEPLOY_KEY_FILE?.replace(/\\/g, '/')).toBe(
        l.name === 'bash' ? bashPath(keyFile) : keyFile.replace(/\\/g, '/'),
      );
      expect(env?.GELDAR_MCP_TOKEN).toBe(MCP);
      expect(env?.CLAUDE_CODE_OAUTH_TOKEN).toBe(LOGIN);
      expectClean(s.w, r);
    });

    it('a second start changes nothing: the workspace is kept and compose runs again', {
      timeout: T,
    }, () => {
      const s = setup(l);
      expect(s.go('start', ID).status).toBe(0);
      const again = s.go('start', ID);
      expect(again.status, again.stderr).toBe(0);
      expect(composeCalls(s.w, 'up')).toHaveLength(2);
      const copies = s.w.calls().filter((c) => c.includes(`geldar-wsinit-${ID}`));
      expect(copies).toHaveLength(1);
      expect(existsSync(join(vol(s.w, `geldar-ws-${ID}`), '.git'))).toBe(true);
    });

    it('stop and restart pass through to compose and keep the volumes', { timeout: T }, () => {
      const s = setup(l);
      const stop = s.go('stop', ID);
      expect(stop.status, stop.stderr).toBe(0);
      expect(stop.stderr).toContain(`${ID} is stopped`);
      expect(composeCalls(s.w, 'stop')).toEqual([
        ['compose', '-p', `geldar-player-${ID}`, '-f', playerYml(l), 'stop'],
      ]);
      const restart = s.go('restart', ID);
      expect(restart.status, restart.stderr).toBe(0);
      expect(restart.stderr).toContain(`${ID} is restarted`);
      expect(composeCalls(s.w, '--force-recreate')).toHaveLength(1);
      expect(s.w.calls().filter((c) => c[0] === 'volume')).toEqual([]);
    });

    it('deploy-key makes a 0600 key in a 0700 folder and prints only the public line', {
      timeout: T,
    }, () => {
      const s = setup(l, { key: false });
      const r = s.go('deploy-key', ID);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe(`ssh-ed25519 AAAAC3STUB1 geldar-${ID}\n`);
      expect(r.stderr).toContain('with write access');
      expect(r.stdout + r.stderr).not.toContain('PRIVATE');
      expect(readFileSync(join(s.p.stateDir, 'deploy-key'), 'utf8')).toContain('STUBPRIVATE1');
      if (process.platform !== 'win32') {
        expect(statSync(s.p.stateDir).mode & 0o777).toBe(0o700);
        expect(statSync(join(s.p.stateDir, 'deploy-key')).mode & 0o777).toBe(0o600);
      }
      const again = s.go('deploy-key', ID);
      expect(again.stdout).toBe(r.stdout);
      expect(readFileSync(join(s.w.root, 'keygen-count'), 'utf8')).toBe('1\n');
    });

    it('deploy-key --rotate replaces the key pair', { timeout: T }, () => {
      const s = setup(l, { key: false });
      expect(s.go('deploy-key', ID).status).toBe(0);
      const r = s.go('deploy-key', ID, '--rotate');
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe(`ssh-ed25519 AAAAC3STUB2 geldar-${ID}\n`);
      expect(r.stderr).toContain('A new deploy key was made');
      expect(readFileSync(join(s.p.stateDir, 'deploy-key'), 'utf8')).toContain('STUBPRIVATE2');
      expect(r.stdout + r.stderr).not.toContain('PRIVATE');
    });

    it('player-status shows the supervisor and keeper status and the HELD reason', (ctx) => {
      if (!canQuote(l)) {
        console.info(`player-status (${l.name}): skipped, the .cmd shims refuse a double quote`);
        ctx.skip();
      }
      const s = setup(l);
      const sup = vol(s.w, `geldar-sup-${ID}`);
      writeFileSync(join(sup, 'status.json'), '{\n  "state": "running"\n}\n');
      const keep = vol(s.w, `geldar-keep-${ID}`);
      writeFileSync(
        join(keep, 'status.json'),
        '{\n  "last_pushed_head": "4f2c9a1",\n  "last_run_utc": "2026-01-10T23:00:00Z"\n}\n',
      );
      writeFileSync(join(keep, 'HELD'), 'the push was rejected: no write access\n');
      const r = s.go('player-status', ID);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('"state": "running"');
      expect(r.stdout).toContain('"last_pushed_head": "4f2c9a1"');
      expect(r.stderr).toContain(
        'The launch is held. Reason: the push was rejected: no write access',
      );
      expectClean(s.w, r);
    });

    it('logs masks the token, the login and token-like text', { timeout: T }, () => {
      const s = setup(l);
      writeFileSync(
        join(vol(s.w, `geldar-sup-${ID}`), 'supervisor.log'),
        `started with GELDAR_MCP_TOKEN=${MCP}\nlogin ${LOGIN}\nspare sk-ant-oat01-SPARE0123456789abcdef\n`,
      );
      writeFileSync(
        join(s.w.dockerRoot, 'compose-logs.txt'),
        `keeper | CLAUDE_CODE_OAUTH_TOKEN=${LOGIN}\n`,
      );
      const r = s.go('logs', ID);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('started with GELDAR_MCP_TOKEN=[masked]');
      expect(r.stdout).toContain('CLAUDE_CODE_OAUTH_TOKEN [masked]');
      expect(r.stdout).toContain('spare [masked]');
      expectClean(s.w, r);
    });

    it('release-hold prints the reason before it removes the hold; no hold is a plain message', {
      timeout: T,
    }, () => {
      const s = setup(l);
      const keep = vol(s.w, `geldar-keep-${ID}`);
      const reason = 'the push was rejected: no write access';
      writeFileSync(join(keep, 'HELD'), `${reason}\n`);
      const r = s.go('release-hold', ID);
      expect(r.status, r.stderr).toBe(0);
      const at = r.stderr.indexOf(reason);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(r.stderr.indexOf(`${ID} is released`));
      expect(existsSync(join(keep, 'HELD'))).toBe(false);
      const none = s.go('release-hold', ID);
      expect(none.status).toBe(0);
      expect(none.stderr).toContain(`${ID} is not held, so there is nothing to release`);
    });

    it('no token, key text or login value reaches output, a docker call or a compose environment', {
      timeout: T,
    }, (ctx) => {
      if (!canQuote(l)) {
        console.info(`no-secret sweep (${l.name}): skipped, it runs player-status (double quote)`);
        ctx.skip();
      }
      const s = setup(l);
      writeFileSync(
        join(vol(s.w, `geldar-sup-${ID}`), 'supervisor.log'),
        `token ${MCP} login ${LOGIN}\n`,
      );
      writeFileSync(
        join(vol(s.w, `geldar-keep-${ID}`), 'status.json'),
        `{\n  "last_pushed_head": "4f2c9a1",\n  "note": "${LOGIN}"\n}\n`,
      );
      writeFileSync(join(s.w.dockerRoot, 'compose-logs.txt'), `keeper | ${MCP}\n`);
      const runs = [
        s.go('start', ID),
        s.go('stop', ID),
        s.go('restart', ID),
        s.go('deploy-key', ID),
        s.go('player-status', ID),
        s.go('logs', ID),
        s.go('release-hold', ID),
      ];
      for (const r of runs) {
        expect(r.status, r.stderr).toBe(0);
        expectClean(s.w, r);
      }
    });
  });
}
