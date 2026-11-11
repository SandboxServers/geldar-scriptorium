import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bashPath,
  git,
  launchers,
  makePlayer,
  makeWorld,
  repoRoot,
  run,
  runLib,
  type World,
} from '../harness.ts';
import { mcpPortSuite } from '../mcp-port-suite.ts';
import { expectNoDockerCall, expectRefusal, modeOf } from './world.ts';

// SC-76c: the bash launcher accepts the owner-set world port and tells the proxy. Every case
// uses a temp share dir (GELDAR_SHARE) holding its own world.conf, never the shipped file.

const bash = launchers.find((l) => l.name === 'bash');
const T = 60_000;

function shareWith(conf: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-share-'));
  mkdirSync(join(dir, 'config'));
  mkdirSync(join(dir, 'compose'));
  writeFileSync(join(dir, 'config', 'world.conf'), conf);
  writeFileSync(join(dir, 'compose', 'session.yml'), 'services: {}\n');
  return dir;
}

const GOOD = 'mcp_base=https://world.example.com:18443\nmcp_port=18443\n';

function setUrl(w: World, clone: string, url: string): void {
  const gitEnv = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
  const f = join(clone, 'player.json');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/"mcp_url": "[^"]*"/, `"mcp_url": "${url}"`));
  git(clone, ['commit', '-am', 'url'], gitEnv);
  git(clone, ['push', 'origin', 'main'], gitEnv);
}

if (bash) {
  mcpPortSuite(bash);

  describe('mcp_port (bash)', () => {
    it('a committed :18443 url under a blank world.conf is the mcp_url refusal', {
      timeout: T,
    }, () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      setUrl(w, p.clone, 'https://world.example.com:18443/p/x');
      const env = { ...w.env, GELDAR_SHARE: bashPath(shareWith('mcp_base=\nmcp_port=\n')) };
      const r = run(bash, ['__prepare', 'abc', 'play'], { env, timeoutMs: T });
      expectRefusal(r, 'bad_player_json', { status: 1 });
      expect(r.stderr).toContain('mcp_url');
      expectNoDockerCall(w);
    });

    it('new --mock with the port under a blank config is bad_url', { timeout: T }, () => {
      const w = makeWorld();
      const env = { ...w.env, GELDAR_SHARE: bashPath(shareWith('mcp_base=\nmcp_port=\n')) };
      const r = run(bash, ['new', 'abc', '--mock', 'http://world.test:18443'], {
        env,
        timeoutMs: T,
      });
      expectRefusal(r, 'bad_url', { status: 1 });
      expectNoDockerCall(w);
    });

    const session = (conf: string, url: string | null) => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      if (url) setUrl(w, p.clone, url);
      const dump = join(w.root, 'dump.sh');
      writeFileSync(dump, 'env > "$FAKE_OUT"\n');
      const out = join(w.root, 'env-dump.txt');
      const env = {
        ...w.env,
        GELDAR_SHARE: bashPath(shareWith(conf)),
        FAKE_SESSION: bashPath(dump),
        FAKE_OUT: bashPath(out),
      };
      const a = run(bash, ['__prepare', 'abc', 'play'], { env, cwd: p.clone, timeoutMs: T });
      const b =
        a.status === 0
          ? run(bash, ['__session', 'abc', 'play'], { env, cwd: p.clone, timeoutMs: T })
          : a;
      return { w, p, a, b, out };
    };

    it('writes the host and the exact port, and exports GELDAR_WORLD_PORTS', { timeout: T }, () => {
      const { p, b, out } = session(GOOD, 'https://world.example.com:18443/p/x');
      expect(b.status, b.stderr).toBe(0);
      const pub = join(p.stateDir, 'pub');
      expect(readFileSync(join(pub, 'allowlist-world.txt'), 'utf8')).toBe('world.example.com\n');
      expect(readFileSync(join(pub, 'allowlist-world-ports.txt'), 'utf8')).toBe('18443\n');
      if (process.platform !== 'win32') {
        expect(modeOf(join(pub, 'allowlist-world.txt'))).toBe(0o644);
        expect(modeOf(join(pub, 'allowlist-world-ports.txt'))).toBe(0o644);
      }
      const m = /^GELDAR_WORLD_PORTS=(.*)$/m.exec(readFileSync(out, 'utf8'));
      expect(m?.[1]?.replace(/\r$/, '').replace(/\\/g, '/')).toMatch(/allowlist-world-ports\.txt$/);
    });

    it('a default https url writes 443', { timeout: T }, () => {
      const d = session('mcp_base=https://mcp.registry.test\nmcp_port=\n', null);
      expect(d.b.status, d.b.stderr).toBe(0);
      expect(readFileSync(join(d.p.stateDir, 'pub', 'allowlist-world-ports.txt'), 'utf8')).toBe(
        '443\n',
      );
    });

    it('an http url writes 80', { timeout: T }, () => {
      const h = session('mcp_base=http://world.test\nmcp_port=\n', 'http://world.test/p/x');
      expect(h.b.status, h.b.stderr).toBe(0);
      expect(readFileSync(join(h.p.stateDir, 'pub', 'allowlist-world-ports.txt'), 'utf8')).toBe(
        '80\n',
      );
    });

    it('an https url with an empty port writes 443', { timeout: T }, () => {
      const d = session(
        'mcp_base=https://world.example.com\nmcp_port=\n',
        'https://world.example.com:/p/x',
      );
      expect(d.b.status, d.b.stderr).toBe(0);
      expect(readFileSync(join(d.p.stateDir, 'pub', 'allowlist-world-ports.txt'), 'utf8')).toBe(
        '443\n',
      );
    });

    it('an http url with an empty port writes 80', { timeout: T }, () => {
      const h = session('mcp_base=http://world.test\nmcp_port=\n', 'http://world.test:/p/x');
      expect(h.b.status, h.b.stderr).toBe(0);
      expect(readFileSync(join(h.p.stateDir, 'pub', 'allowlist-world-ports.txt'), 'utf8')).toBe(
        '80\n',
      );
    });

    it('a host that differs from mcp_base on the port is refused with no docker call', {
      timeout: T,
    }, () => {
      const s = session(GOOD, 'https://other.example.com:18443/p/x');
      expectRefusal(s.a, 'bad_player_json', { status: 1 });
      expectNoDockerCall(s.w);
    });

    // SC-80: the host must equal mcp_base on the default ports too.
    it('a wrong host on 443 is refused with no docker call', { timeout: T }, () => {
      const s = session(GOOD, 'https://other.example.com:443/p/x');
      expectRefusal(s.a, 'bad_player_json', { status: 1 });
      expectNoDockerCall(s.w);
    });

    it('the right host on 443 passes', { timeout: T }, () => {
      const s = session(GOOD, 'https://world.example.com:443/p/x');
      expect(s.b.status, s.b.stderr).toBe(0);
    });

    it('a missing mcp_base refuses a default-port url', { timeout: T }, () => {
      const s = session('mcp_base=\nmcp_port=\n', 'https://world.example.com:443/p/x');
      expectRefusal(s.a, 'bad_player_json', { status: 1 });
      expectNoDockerCall(s.w);
    });

    it('fails closed when world_conf is undefined', { timeout: T }, () => {
      const dir = bashPath(shareWith(GOOD));
      const lib = bashPath(join(repoRoot, 'launcher', 'lib', 'player.sh'));
      const r = runLib(bash, {
        bash: `. '${lib}'; export GELDAR_SHARE='${dir}'; if valid_mcp_url 'https://world.example.com:18443/p/x'; then echo ok; fi; unset -f world_conf; if valid_mcp_url 'https://world.example.com:18443/p/x'; then echo ok; else echo no; fi`,
        pwsh: '',
      });
      expect(r.stdout.split(/\r?\n/).filter(Boolean)).toEqual(['ok', 'no']);
    });
  });
}
