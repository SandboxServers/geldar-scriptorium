import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { devWorldSuite } from '../devworld-suite.ts';
import {
  bashPath,
  git,
  launchers,
  makePlayer,
  makeWorld,
  repoRoot,
  run,
  type World,
} from '../harness.ts';
import { expectNoDockerCall, expectRefusal } from './world.ts';

// SC-75b: the bash launcher's human-only local-world override. The suite (SC-75a) holds the URL
// table; these cases are the hostile ones around it.

const bash = launchers.find((l) => l.name === 'bash');
const T = 180_000;
const URL = (id: string, port = 8787) => `http://host.docker.internal:${port}/p/${id}`;
const share = bashPath(join(repoRoot, 'image'));
const text = (p: string) => readFileSync(p, 'utf8');

function probe(w: World): Record<string, string> {
  const f = join(w.root, 'dw-probe.sh');
  writeFileSync(f, `env > "${bashPath(join(w.root, 'dw-env.txt'))}"\n`);
  return { FAKE_SESSION: bashPath(f) };
}

if (bash) {
  devWorldSuite(bash);

  describe('dev world hostile cases (bash)', () => {
    const base = (w: World, extra: Record<string, string> = {}) => ({
      ...w.env,
      GELDAR_SHARE: share,
      ...extra,
    });
    const start = (w: World, id: string, extra: Record<string, string> = {}) => {
      const env = base(w, extra);
      const a = run(bash, ['__prepare', id, 'play'], { env, timeoutMs: 120_000 });
      expect(a.status, a.stderr).toBe(0);
      return run(bash, ['__session', id, 'play'], { env, timeoutMs: 120_000 });
    };

    it('a player.json with the dev host is still refused by valid_mcp_url', { timeout: T }, () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      const f = join(p.clone, 'player.json');
      writeFileSync(f, text(f).replace(/"mcp_url": "[^"]*"/, `"mcp_url": "${URL('x')}"`));
      const gitEnv = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
      git(p.clone, ['commit', '-am', 'url'], gitEnv);
      git(p.clone, ['push', 'origin', 'main'], gitEnv);
      const r = run(bash, ['__prepare', 'abc', 'play'], { env: base(w), timeoutMs: 120_000 });
      expectRefusal(r, 'bad_player_json', { status: 1 });
      expectNoDockerCall(w);
    });

    it('a dev-world file or a variable line in the clone is ignored', { timeout: T }, () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      writeFileSync(join(p.clone, 'dev-world'), `${URL('abc')}\n`);
      writeFileSync(join(p.clone, '.env'), `GELDAR_DEV_MCP_URL=${URL('abc')}\n`);
      writeFileSync(join(p.clone, 'GELDAR_DEV_MCP_URL'), `${URL('abc')}\n`);
      const gitEnv = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
      git(p.clone, ['add', '-A'], gitEnv);
      git(p.clone, ['commit', '-m', 'decoys'], gitEnv);
      git(p.clone, ['push', 'origin', 'main'], gitEnv);
      const r = start(w, 'abc');
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).not.toContain('dev_world');
      expect(r.stderr).not.toContain('Dev world active');
      const o = text(join(p.stateDir, 'session', 'override.yml'));
      expect(o).not.toContain('host.docker.internal');
      expect(existsSync(join(p.stateDir, 'pub', 'allowlist-world.txt'))).toBe(true);
      expect(text(join(p.stateDir, 'pub', 'allowlist-world.txt'))).not.toContain('docker');
    });

    it('the variable is absent from the container environment and the compose files', {
      timeout: T,
    }, () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      const r = start(w, 'abc', { ...probe(w), GELDAR_DEV_MCP_URL: URL('abc') });
      expect(r.status, r.stderr).toBe(0);
      const dump = text(join(w.root, 'dw-env.txt'));
      expect(dump).not.toContain('GELDAR_DEV_MCP_URL');
      expect(dump).not.toContain('GELDAR_MCP_TOKEN=');
      const o = text(join(p.stateDir, 'session', 'override.yml'));
      expect(o).not.toContain('GELDAR_DEV_MCP_URL');
      expect(o).toContain(`GELDAR_MCP_URL: "${URL('abc')}"`);
      expect(o).toContain(
        '  proxy:\n    extra_hosts:\n      - "host.docker.internal:host-gateway"\n',
      );
      for (const c of w.calls()) expect(c.join(' ')).not.toContain('GELDAR_DEV_MCP_URL');
    });

    it('two ids with the variable set is dev_world_single and starts nothing', {
      timeout: T,
    }, () => {
      const w = makeWorld();
      makePlayer(w, { id: 'abc' });
      makePlayer(w, { id: 'def' });
      const r = run(bash, ['play', 'abc', 'def'], {
        env: base(w, { GELDAR_DEV_MCP_URL: URL('abc') }),
        timeoutMs: 120_000,
      });
      expectRefusal(r, 'dev_world_single', { status: 1 });
      expectNoDockerCall(w);
    });

    it('nothing leaks to the player started next with the variable unset', { timeout: T }, () => {
      const w = makeWorld();
      const p1 = makePlayer(w, { id: 'abc' });
      const p = makePlayer(w, { id: 'def' });
      const first = start(w, 'abc', { GELDAR_DEV_MCP_URL: URL('abc') });
      expect(first.status, first.stderr).toBe(0);
      expect(text(join(p1.stateDir, 'session', 'override.yml'))).toContain('extra_hosts');
      const second = start(w, 'def');
      expect(second.status, second.stderr).toBe(0);
      expect(second.stderr).not.toContain('dev_world');
      const root = join(p.stateDir, '..');
      expect(readdirSync(root).filter((n) => /dev|8787/.test(n))).toEqual([]);
      const o = text(join(p.stateDir, 'session', 'override.yml'));
      expect(o).not.toContain('extra_hosts');
      expect(o).not.toContain('host.docker.internal');
      expect(text(join(p.stateDir, 'pub', 'allowlist-world.txt'))).not.toContain('docker');
      expect(text(join(p.stateDir, 'pub', 'allowlist-world-ports.txt'))).not.toBe('8787\n');
      const left = readdirSync(p.stateDir).filter((n) => /dev|8787/.test(n));
      expect(left).toEqual([]);
      for (const f of ['start', 'token']) {
        const q = join(p.stateDir, f);
        if (existsSync(q)) expect(text(q)).not.toContain('host.docker.internal');
      }
    });
  });
}
