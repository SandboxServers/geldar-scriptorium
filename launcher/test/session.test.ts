import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bashExe,
  bashPath,
  childEnv,
  forGroup,
  git,
  type Launcher,
  makePlayer,
  makeWorld,
  type Player,
  repoRoot,
  run,
  runBash,
  type World,
} from './harness.ts';

vi.setConfig({ testTimeout: 180_000 });

const text = (p: string) => readFileSync(p, 'utf8');
const win = process.platform === 'win32';
const share = bashPath(join(repoRoot, 'image'));
const fakeDocker = bashPath(join(repoRoot, 'launcher', 'test', 'fake-docker.sh'));
const composeWorks = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
const TOKEN = 'MOCK-TOKEN-4f9a1c77d2b8';

function envOf(l: Launcher, w: World, extra: Record<string, string> = {}) {
  return { ...(l.name === 'bash' ? w.env : w.envPwsh), GELDAR_SHARE: share, ...extra };
}

function gitEnv(w: World) {
  return { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
}

// A player with extra top-level files committed in the clone (so they are exported).
function player(w: World, id: string, files: Record<string, string> = {}, mcp?: string): Player {
  const p = makePlayer(w, { id });
  const changed = Object.keys(files).length > 0 || mcp !== undefined;
  for (const [f, body] of Object.entries(files)) writeFileSync(join(p.clone, f), body);
  if (mcp !== undefined) {
    const f = join(p.clone, 'player.json');
    const j = JSON.parse(text(f));
    j.mcp_url = mcp;
    writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
  }
  if (changed) {
    git(p.clone, ['add', '-A'], gitEnv(w));
    git(p.clone, ['commit', '-m', 'extra'], gitEnv(w));
  }
  return p;
}

function start(
  l: Launcher,
  w: World,
  p: Player,
  mode = 'play',
  extra: Record<string, string> = {},
) {
  const env = envOf(l, w, { FAKE_OUT: bashPath(join(w.root, `env-${p.id}.txt`)), ...extra });
  const a = run(l, ['__prepare', p.id, mode], { env, timeoutMs: 120_000 });
  expect(a.status, a.stderr).toBe(0);
  return run(l, ['__session', p.id, mode], { env, timeoutMs: 120_000 });
}

function dumpSession(w: World) {
  const f = join(w.root, 'dump.sh');
  writeFileSync(f, 'env > "$FAKE_OUT"\n');
  return { FAKE_SESSION: bashPath(f) };
}

const sessionDir = (p: Player) => join(p.stateDir, 'session');
const runCalls = (w: World) => w.calls().filter((c) => c[0] === 'compose' && c.includes('run'));
const filesOf = (c: string[]) => c.filter((_, i) => c[i - 1] === '-f');

function composeConfig(w: World, p: Player, extraEnv: Record<string, string> = {}) {
  if (!bashExe) throw new Error('no bash');
  const sd = bashPath(sessionDir(p));
  const env = childEnv({
    ...w.env,
    GELDAR_UID: '1000',
    GELDAR_GID: '1000',
    GELDAR_WORKSPACE: `geldar-ws-${p.id}`,
    GELDAR_CLI_HOME: `geldar-cli-${p.id}-claude`,
    KIT_IMAGE: `registry.test/geldar-kit@sha256:${'a'.repeat(64)}`,
    GELDAR_WORLD_ALLOWLIST: `${sd}/allowlist-world.txt`,
    GELDAR_MODE: 'play',
    ...extraEnv,
  });
  const args = ['compose', '-p', 't', '-f', `${share}/compose/session.yml`];
  args.push('-f', `${sd}/override.yml`, 'config', '--format', 'json');
  return spawnSync(bashExe, [fakeDocker, ...args], { encoding: 'utf8', env });
}

describe.each(forGroup('session'))('session ($name)', (launcher) => {
  it('1. the merged compose config has exactly the kit overlays and two volumes', () => {
    if (!composeWorks) {
      expect(process.env.CI, 'docker compose is required in CI').toBeFalsy();
      return;
    }
    const w = makeWorld();
    const p = player(w, 'one');
    const r = start(launcher, w, p, 'play', dumpSession(w));
    expect(r.status, r.stderr).toBe(0);
    const c = composeConfig(w, p);
    expect(c.status, c.stderr).toBe(0);
    const cfg = JSON.parse(c.stdout);
    const s = cfg.services.session;
    expect(s.network_mode).toBeUndefined();
    expect(Object.keys(s.networks)).toEqual(['inside']);
    type Vol = { type: string; source: string; target: string; read_only?: boolean };
    const vols = s.volumes as Vol[];
    const tracked = git(p.clone, ['ls-tree', '--name-only', 'HEAD']).split('\n');
    const want = tracked.filter((n) => n !== 'memory' && n !== 'skills').map((n) => `/player/${n}`);
    expect(want).toContain('/player/CLAUDE.md');
    expect(vols.map((v) => v.target).sort()).toEqual(['/cli-home', '/player', ...want].sort());
    for (const v of vols) {
      if (v.target === '/player') expect([v.type, v.source]).toEqual(['volume', 'geldar_ws']);
      else if (v.target === '/cli-home') {
        expect([v.type, v.source]).toEqual(['volume', 'geldar_cli']);
      } else {
        expect(v.type).toBe('bind');
        expect(v.read_only).toBe(true);
        expect(v.source.replace(/\\/g, '/')).toMatch(/\/session\/export\/[^/]+$/);
      }
    }
    expect(cfg.volumes.geldar_ws).toMatchObject({ name: 'geldar-ws-one', external: true });
    expect(cfg.volumes.geldar_cli).toMatchObject({ name: 'geldar-cli-one-claude', external: true });
    expect(cfg.networks.inside.internal).toBe(true);
  });

  it('2. H-06: nothing of the human leaks into the merged config or the override', () => {
    const w = makeWorld();
    const p = player(w, 'two');
    const r = start(launcher, w, p, 'play', dumpSession(w));
    expect(r.status, r.stderr).toBe(0);
    const o = text(join(sessionDir(p), 'override.yml'));
    const bads = ['GH_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC', '.ssh', '.gitconfig', 'docker.sock'];
    for (const bad of bads) expect(o, bad).not.toContain(bad);
    if (!composeWorks) return;
    const c = composeConfig(w, p, {
      GH_TOKEN: 'dummy-gh',
      GITHUB_TOKEN: 'dummy-ghb',
      ANTHROPIC_API_KEY: 'dummy-anth',
    });
    expect(c.status, c.stderr).toBe(0);
    for (const bad of ['dummy-gh', 'dummy-anth', ...bads]) expect(c.stdout, bad).not.toContain(bad);
    // Every source is a named volume or lies inside this test world's state folder.
    const world = basename(w.root).toLowerCase();
    for (const v of JSON.parse(c.stdout).services.session.volumes as { source: string }[]) {
      const src = v.source.replace(/\\/g, '/').toLowerCase();
      expect(src.startsWith('geldar_') || src.includes(`/${world}/state/`), v.source).toBe(true);
    }
  });

  it('3. H-07: each player has its own CLI volume, never the workspace volume', () => {
    const w = makeWorld();
    const a = player(w, 'a-one');
    const b = player(w, 'b-one');
    expect(start(launcher, w, a).status).toBe(0);
    expect(start(launcher, w, b).status).toBe(0);
    const created = w
      .calls()
      .filter((c) => c[0] === 'volume' && c[1] === 'create')
      .map((c) => c[2]);
    expect(created).toContain('geldar-cli-a-one-claude');
    expect(created).toContain('geldar-cli-b-one-claude');
    for (const p of [a, b]) {
      const o = text(join(sessionDir(p), 'override.yml'));
      expect(o).toContain(`name: "geldar-cli-${p.id}-claude"`);
      expect(o).toContain(`name: "geldar-ws-${p.id}"`);
      expect(o).not.toContain(`geldar-cli-${p === a ? 'b' : 'a'}-one`);
    }
  });

  it('4. H-08: the allowlist is the bare host, 0644 in a 0755 directory', () => {
    const w = makeWorld();
    const p = player(w, 'four', {}, 'https://mcp.registry.test:443/mcp/v1');
    const r = start(launcher, w, p);
    expect(r.status, r.stderr).toBe(0);
    const f = join(sessionDir(p), 'allowlist-world.txt');
    expect(text(f)).toBe('mcp.registry.test\n');
    if (!win) {
      expect(statSync(f).mode & 0o777).toBe(0o644);
      expect(statSync(sessionDir(p)).mode & 0o777).toBe(0o755);
    }
  });

  it('5. H-19: only the share compose file and the override are used', () => {
    const w = makeWorld();
    const p = player(w, 'five', {
      'docker-compose.yml': 'services: {}\n',
      'compose.override.yml': 'services: {}\n',
    });
    mkdirSync(join(p.clone, '.devcontainer'), { recursive: true });
    writeFileSync(join(p.clone, '.devcontainer', 'devcontainer.json'), '{}\n');
    git(p.clone, ['add', '-A'], gitEnv(w));
    git(p.clone, ['commit', '-m', 'dev'], gitEnv(w));
    const r = start(launcher, w, p);
    expect(r.status, r.stderr).toBe(0);
    const c = runCalls(w)[0] as string[];
    expect(filesOf(c)).toEqual([
      `${share}/compose/session.yml`,
      `${bashPath(sessionDir(p))}/override.yml`,
    ]);
    expect(text(join(sessionDir(p), 'override.yml'))).toContain('/player/docker-compose.yml');
  });

  it('5b. the extra compose file and the stub passthrough count only under GELDAR_INTERNAL', () => {
    const w = makeWorld();
    const p = player(w, 'fiveb');
    const extra = bashPath(join(w.root, 'extra.yml'));
    writeFileSync(join(w.root, 'extra.yml'), 'services: {}\n');
    const on = { GELDAR_EXTRA_COMPOSE: extra, GELDAR_STUB_X: '1' };
    expect(start(launcher, w, p, 'play', on).status).toBe(0);
    const c1 = runCalls(w)[0] as string[];
    expect(filesOf(c1)).toHaveLength(3);
    expect(filesOf(c1)[2]).toBe(extra);
    expect(text(join(sessionDir(p), 'override.yml'))).toContain('GELDAR_STUB_X:');
    const libs = ['common', 'player', 'session']
      .map((n) => `. "${bashPath(join(repoRoot, 'launcher', 'lib', `${n}.sh`))}"`)
      .join('; ');
    const env = { ...envOf(launcher, w, on), GELDAR_INTERNAL: '' };
    const r = runBash(
      `GP_DIR="${bashPath(join(repoRoot, 'launcher'))}"; GP_GROUPS=; ${libs}; start_session fiveb play`,
      { env },
    );
    expect(r.status, r.stderr).toBe(0);
    const c2 = runCalls(w)[1] as string[];
    expect(filesOf(c2)).toHaveLength(2);
    expect(text(join(sessionDir(p), 'override.yml'))).not.toContain('GELDAR_STUB_X');
  });

  it('6. the mode picks the settings file, the skill and GELDAR_MODE', () => {
    const w = makeWorld();
    for (const mode of ['play', 'setup']) {
      const p = player(w, `six-${mode}`);
      const r = start(launcher, w, p, mode, dumpSession(w));
      expect(r.status, r.stderr).toBe(0);
      const last = runCalls(w).pop() as string[];
      expect(last.slice(last.indexOf('session') + 1)).toEqual([
        'claude',
        '--settings',
        `/etc/geldar/settings/${mode}.json`,
        `/${mode}`,
      ]);
      expect(text(join(w.root, `env-six-${mode}.txt`))).toContain(`GELDAR_MODE=${mode}\n`);
    }
  });

  it('7. the token reaches the session by environment only', () => {
    const w = makeWorld();
    const p = player(w, 'seven');
    writeFileSync(join(p.stateDir, 'token'), `${TOKEN}\n`, { mode: 0o600 });
    const r = start(launcher, w, p, 'play', dumpSession(w));
    expect(r.status, r.stderr).toBe(0);
    expect(text(join(w.root, 'env-seven.txt'))).toContain(`GELDAR_MCP_TOKEN=${TOKEN}\n`);
    expect(text(join(sessionDir(p), 'override.yml'))).not.toContain(TOKEN);
    expect(text(join(w.dockerRoot, 'calls.log'))).not.toContain(TOKEN);
    // No token file: a stale value in the human's shell is not passed on.
    const q = player(w, 'seven-b');
    const s = start(launcher, w, q, 'play', { ...dumpSession(w), GELDAR_MCP_TOKEN: 'STALE-OTHER' });
    expect(s.status, s.stderr).toBe(0);
    expect(text(join(w.root, 'env-seven-b.txt'))).not.toContain('STALE-OTHER');
  });

  it('8. down never removes volumes and the host clone is untouched', () => {
    const w = makeWorld();
    const p = player(w, 'eight');
    const before = git(p.clone, ['status', '--porcelain', '--untracked-files=all']);
    const r = start(launcher, w, p, 'play', dumpSession(w));
    expect(r.status, r.stderr).toBe(0);
    const down = w.calls().find((c) => c[0] === 'compose' && c.includes('down')) as string[];
    expect(down).toBeDefined();
    expect(down).not.toContain('-v');
    expect(down).not.toContain('--volumes');
    expect(down).toContain('--remove-orphans');
    expect(existsSync(join(sessionDir(p), 'exit'))).toBe(true);
    expect(git(p.clone, ['status', '--porcelain', '--untracked-files=all'])).toBe(before);
  });

  it('9. an export entry with an unsafe name is refused', () => {
    const w = makeWorld();
    const p = player(w, 'nine', { 'a b': 'x\n' });
    const r = start(launcher, w, p);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('cannot be mounted safely');
    expect(runCalls(w)).toHaveLength(0);
  });
});
