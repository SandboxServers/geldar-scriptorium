import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { devWorldSuite } from '../devworld-suite.ts';
import { bashPath, git, launchers, makePlayer, makeWorld, repoRoot, run } from '../harness.ts';
import { expectNoDockerCall, expectRefusal } from './world.ts';

// SC-75c: the dev-world override of the PowerShell launcher (decision 33).

const pwsh = launchers.find((l) => l.name === 'pwsh');
const T = 120_000;
const share = bashPath(join(repoRoot, 'image'));
const url = (id: string) => `http://host.docker.internal:8787/p/${id}`;

if (pwsh) {
  devWorldSuite(pwsh);

  describe('dev world hostile cases (pwsh)', () => {
    const start = (w: ReturnType<typeof makeWorld>, id: string, extra: Record<string, string>) => {
      const env = { ...w.envPwsh, GELDAR_SHARE: share, ...extra };
      const prep = run(pwsh, ['__prepare', id, 'play'], { env, timeoutMs: T });
      expect(prep.status, prep.stderr).toBe(0);
      return run(pwsh, ['__session', id, 'play'], { env, timeoutMs: T });
    };

    it('a player.json with a host.docker.internal mcp_url is still bad_player_json', {
      timeout: T,
    }, () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      const gitEnv = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
      const f = join(p.clone, 'player.json');
      writeFileSync(
        f,
        readFileSync(f, 'utf8').replace(/"mcp_url": "[^"]*"/, `"mcp_url": "${url('x')}"`),
      );
      git(p.clone, ['commit', '-am', 'dev url'], gitEnv);
      git(p.clone, ['push', 'origin', 'main'], gitEnv);
      const r = run(pwsh, ['__prepare', 'abc', 'play'], { env: w.envPwsh, timeoutMs: T });
      expectRefusal(r, 'bad_player_json', { status: 1 });
      expectNoDockerCall(w);
    });

    it('a dev-world file or a line in the clone is ignored', { timeout: T }, () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      writeFileSync(join(p.clone, 'dev-world'), `${url('abc')}\n`);
      writeFileSync(join(p.clone, 'notes.txt'), `GELDAR_DEV_MCP_URL=${url('abc')}\n`);
      const gitEnv = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
      git(p.clone, ['add', '-A'], gitEnv);
      git(p.clone, ['commit', '-m', 'decoys'], gitEnv);
      git(p.clone, ['push', 'origin', 'main'], gitEnv);
      const r = start(w, 'abc', {});
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).not.toContain('dev_world');
      const o = readFileSync(join(p.stateDir, 'session', 'override.yml'), 'utf8');
      expect(o).not.toContain('host.docker.internal');
    });

    it('the variable is not in the container environment', { timeout: T }, () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      const dump = join(w.root, 'env.txt');
      const script = join(w.root, 'dump.sh');
      writeFileSync(script, `env > "${bashPath(dump)}"\n`);
      const r = start(w, 'abc', {
        FAKE_SESSION: bashPath(script),
        GELDAR_DEV_MCP_URL: url('abc'),
      });
      expect(r.status, r.stderr).toBe(0);
      const env = readFileSync(dump, 'utf8');
      expect(env).not.toContain('GELDAR_DEV_MCP_URL');
      const o = readFileSync(join(p.stateDir, 'session', 'override.yml'), 'utf8');
      expect(o).not.toContain('GELDAR_DEV_MCP_URL');
      expect(o).toContain(`GELDAR_MCP_URL: "${url('abc')}"`);
      expect(o).toContain('host.docker.internal:host-gateway');
    });

    it('two ids with the variable set is dev_world_single and starts nothing', {
      timeout: T,
    }, () => {
      const w = makeWorld();
      makePlayer(w, { id: 'abc' });
      makePlayer(w, { id: 'def' });
      const r = run(pwsh, ['play', 'abc', 'def'], {
        env: { ...w.envPwsh, GELDAR_DEV_MCP_URL: url('abc') },
        timeoutMs: T,
      });
      expectRefusal(r, 'dev_world_single', { status: 1 });
      expectNoDockerCall(w);
    });

    it('the next player started with the variable unset gets no override', { timeout: T }, () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      const q = makePlayer(w, { id: 'def' });
      const a = start(w, 'abc', { GELDAR_DEV_MCP_URL: url('abc') });
      expect(a.status, a.stderr).toBe(0);
      const b = start(w, 'def', {});
      expect(b.status, b.stderr).toBe(0);
      expect(b.stderr).not.toContain('dev_world');
      const o = readFileSync(join(q.stateDir, 'session', 'override.yml'), 'utf8');
      expect(o).not.toContain('host.docker.internal');
      expect(o).not.toContain('extra_hosts');
      const h = readFileSync(join(q.stateDir, 'pub', 'allowlist-world.txt'), 'utf8');
      expect(h).toBe('mcp.registry.test\n');
      expect(existsSync(join(p.stateDir, 'pub', 'allowlist-world.txt'))).toBe(true);
    });
  });
}
