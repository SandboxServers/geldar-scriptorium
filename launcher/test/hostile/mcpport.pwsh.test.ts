import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bashPath, git, launchers, makePlayer, makeWorld, repoRoot, run } from '../harness.ts';
import { mcpPortSuite } from '../mcp-port-suite.ts';
import { expectNoDockerCall, expectRefusal } from './world.ts';

// SC-76d: the pwsh launcher accepts the owner-set world port only (decision 34).

const pwsh = launchers.find((l) => l.name === 'pwsh');
const T = 60_000;
const BASE = 'https://world.example.com:18443';
const URL = `${BASE}/p/x`;

function share(base: string, port: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-mcp-share-'));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'config', 'world.conf'), `mcp_base=${base}\nmcp_port=${port}\n`);
  return dir;
}

// Commits a player.json with the given mcp_url to the player's origin.
function setUrl(w: ReturnType<typeof makeWorld>, clone: string, url: string): void {
  const gitEnv = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
  const f = join(clone, 'player.json');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/"mcp_url": "[^"]*"/, `"mcp_url": "${url}"`));
  git(clone, ['commit', '-am', 'port url'], gitEnv);
  git(clone, ['push', 'origin', 'main'], gitEnv);
}

if (pwsh) {
  mcpPortSuite(pwsh);

  describe('mcp_port (pwsh)', () => {
    it('a committed :18443 url under a blank world.conf is the mcp_url refusal', {
      timeout: T,
    }, () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      setUrl(w, p.clone, URL);
      const env = { ...w.envPwsh, GELDAR_SHARE: share('', '') };
      const r = run(pwsh, ['__prepare', 'abc', 'play'], { env, timeoutMs: T });
      expectRefusal(r, 'bad_player_json', { status: 1 });
      expect(r.stderr).toContain('mcp_url');
      expectNoDockerCall(w);
    });

    it('new --mock http://world.test:18443 is bad_url under a blank config', { timeout: T }, () => {
      const w = makeWorld();
      const env = { ...w.envPwsh, GELDAR_SHARE: share('', '') };
      const r = run(pwsh, ['new', 'abc', '--mock', 'http://world.test:18443'], {
        env,
        timeoutMs: T,
      });
      expectRefusal(r, 'bad_url', { status: 1 });
      expectNoDockerCall(w);
    });

    it('a host that differs from mcp_base is refused', { timeout: T }, () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      setUrl(w, p.clone, 'https://other.example.com:18443/p/x');
      const env = { ...w.envPwsh, GELDAR_SHARE: share(BASE, '18443') };
      const r = run(pwsh, ['__prepare', 'abc', 'play'], { env, timeoutMs: T });
      expectRefusal(r, 'bad_player_json', { status: 1 });
      expectNoDockerCall(w);
    });

    // SC-80: the host must equal mcp_base on the default ports too.
    for (const [label, base, port] of [
      ['a wrong host on 443', BASE, '18443'],
      ['a missing mcp_base', '', ''],
    ] as const)
      it(`${label} is refused`, { timeout: T }, () => {
        const w = makeWorld();
        const p = makePlayer(w, { id: 'abc' });
        setUrl(
          w,
          p.clone,
          label === 'a missing mcp_base'
            ? 'https://world.example.com:443/p/x'
            : 'https://other.example.com:443/p/x',
        );
        const env = { ...w.envPwsh, GELDAR_SHARE: share(base, port) };
        const r = run(pwsh, ['__prepare', 'abc', 'play'], { env, timeoutMs: T });
        expectRefusal(r, 'bad_player_json', { status: 1 });
        expectNoDockerCall(w);
      });

    it('the right host on 443 passes', { timeout: T }, () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      setUrl(w, p.clone, 'https://world.example.com:443/p/x');
      const env = { ...w.envPwsh, GELDAR_SHARE: share(BASE, '18443') };
      const r = run(pwsh, ['__prepare', 'abc', 'play'], { env, timeoutMs: T });
      expect(r.status, r.stderr).toBe(0);
    });

    for (const [url, base, port, want] of [
      [URL, BASE, '18443', '18443'],
      ['https://mcp.registry.test/mcp', 'https://mcp.registry.test', '', '443'],
      ['http://mcp.registry.test/mcp', 'http://mcp.registry.test', '', '80'],
      ['https://world.example.com:/p/x', 'https://world.example.com', '', '443'],
      ['http://world.test:/p/x', 'http://world.test', '', '80'],
    ] as const)
      it(`a session start for ${url} writes both allowlist files and exports GELDAR_WORLD_PORTS`, {
        timeout: T,
      }, () => {
        const w = makeWorld();
        const p = makePlayer(w, { id: 'abc' });
        setUrl(w, p.clone, url);
        const dump = join(w.root, 'dump.sh');
        writeFileSync(dump, 'env > "$FAKE_OUT"\n');
        const out = join(w.root, 'env-dump.txt');
        const env = {
          ...w.envPwsh,
          GELDAR_SHARE: share(base, port),
          FAKE_SESSION: bashPath(dump),
          FAKE_OUT: bashPath(out),
        };
        const a = run(pwsh, ['__prepare', 'abc', 'play'], { env, timeoutMs: T });
        expect(a.status, a.stderr).toBe(0);
        const b = run(pwsh, ['__session', 'abc', 'play'], { env, timeoutMs: T });
        expect(b.status, b.stderr).toBe(0);
        const pub = join(p.stateDir, 'pub');
        expect(readFileSync(join(pub, 'allowlist-world-ports.txt'), 'utf8')).toBe(`${want}\n`);
        expect(readFileSync(join(pub, 'allowlist-world.txt'), 'utf8')).toMatch(/^[^:/\s]+\n$/);
        if (process.platform !== 'win32') {
          expect(statSync(join(pub, 'allowlist-world-ports.txt')).mode & 0o777).toBe(0o644);
          expect(statSync(join(pub, 'allowlist-world.txt')).mode & 0o777).toBe(0o644);
        }
        const dumped = readFileSync(out, 'utf8');
        expect(dumped).toMatch(/^GELDAR_WORLD_PORTS=.*allowlist-world-ports\.txt$/m);
        expect(existsSync(out)).toBe(true);
      });

    it('fails closed when Get-WorldConf is not defined', { timeout: T }, () => {
      const lib = join(repoRoot, 'launcher', 'lib', 'player.ps1').replace(/'/g, "''");
      const sd = share(BASE, '18443').replace(/'/g, "''");
      // Only player.* and a stub common: the reader does not exist.
      const script = `function Get-ShareDir { '${sd}' }; . '${lib}'; if (Test-McpUrl '${URL}') { 'ok' } else { 'no' }`;
      const r = spawnSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
      expect(r.stdout.split(/\r?\n/).filter(Boolean)).toEqual(['no']);
    });

    it('the same check passes once Get-WorldConf is defined (positive control)', {
      timeout: T,
    }, () => {
      const lib = join(repoRoot, 'launcher', 'lib', 'player.ps1').replace(/'/g, "''");
      const sd = share(BASE, '18443').replace(/'/g, "''");
      // Same setup as the fail-closed case, plus a reader that returns the owner-set world.conf values.
      const reader = `function Get-WorldConf([string]$Key) { if ($Key -eq 'mcp_port') { '18443' } else { '${BASE}' } }`;
      const script = `function Get-ShareDir { '${sd}' }; ${reader}; . '${lib}'; if (Test-McpUrl '${URL}') { 'ok' } else { 'no' }`;
      const r = spawnSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
      expect(r.stdout.split(/\r?\n/).filter(Boolean)).toEqual(['ok']);
    });
  });
}
