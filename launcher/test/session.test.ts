import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

// Hard failure in CI, a quiet skip on a machine without docker compose (T6).
function composeAvailable(): boolean {
  if (composeWorks) return true;
  if (process.env.CI) throw new Error('docker compose is required in CI');
  return false;
}

// Paths (relative to dir, with /) of the files whose text holds the needle.
function holders(dir: string, needle: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...holders(dir, needle, r));
    else if (readFileSync(join(dir, r), 'latin1').includes(needle)) out.push(r);
  }
  return out.sort();
}

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
    if (!composeAvailable()) return;
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
    expect(cfg.networks.outside.internal).toBeFalsy();
    expect(s.cap_drop).toEqual(['ALL']);
    expect(s.security_opt ?? []).toContain('no-new-privileges:true');
    const svcs = Object.entries(cfg.services) as [string, Record<string, unknown>][];
    for (const [name, svc] of svcs) {
      expect(svc.ports, `${name} ports`).toBeUndefined();
      expect(svc.privileged, `${name} privileged`).toBeFalsy();
    }
    const dual = svcs.filter(([, v]) => Object.keys(v.networks as object).length > 1);
    expect(dual.map(([n]) => n)).toEqual(['proxy']);
  });

  it('2. H-06: nothing of the human leaks into the merged config or the override', () => {
    const w = makeWorld();
    const p = player(w, 'two');
    const r = start(launcher, w, p, 'play', dumpSession(w));
    expect(r.status, r.stderr).toBe(0);
    const o = text(join(sessionDir(p), 'override.yml'));
    const bads = ['GH_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC', '.ssh', '.gitconfig', 'docker.sock'];
    for (const bad of bads) expect(o, bad).not.toContain(bad);
    if (!composeAvailable()) return;
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
    // umask 077 makes a missing chmod visible: mkdir and printf would give 0700 and 0600.
    const strict = {
      ...launcher,
      prefix: ['-c', 'umask 077; . "$0"'],
      entry: bashPath(launcher.entry),
    };
    const r = start(strict, w, p);
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
    // Only the 0600 token file holds it, anywhere in the state folder.
    expect(holders(w.state, TOKEN)).toEqual(['seven/token']);
    if (!win) expect(statSync(join(p.stateDir, 'token')).mode & 0o777).toBe(0o600);
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

  it('7b. the state scan sees a token planted in an unrelated file', () => {
    const w = makeWorld();
    const p = player(w, 'sevenb');
    writeFileSync(join(p.stateDir, 'token'), `${TOKEN}\n`, { mode: 0o600 });
    expect(start(launcher, w, p, 'play', dumpSession(w)).status).toBe(0);
    writeFileSync(join(sessionDir(p), 'notes.txt'), `leak ${TOKEN}\n`);
    expect(holders(w.state, TOKEN)).toEqual(['sevenb/session/notes.txt', 'sevenb/token']);
  });

  it('10. a state path with a colon, comma or control character is refused', () => {
    const w = makeWorld();
    player(w, 'ten');
    const env = envOf(launcher, w);
    const a = run(launcher, ['__prepare', 'ten', 'play'], { env, timeoutMs: 120_000 });
    expect(a.status, a.stderr).toBe(0);
    const hostile = win ? [',', ';,;'] : [':', ',', '\n', '\t', '&:&'];
    const libs = ['common', 'player', 'session']
      .map((n) => `. "${bashPath(join(repoRoot, 'launcher', 'lib', `${n}.sh`))}"`)
      .join('; ');
    const pre = `GP_DIR="${bashPath(join(repoRoot, 'launcher'))}"; GP_GROUPS=; ${libs}; `;
    const msg = 'cannot be used here';
    hostile.forEach((bit, i) => {
      const root = join(w.root, `hostile${i}`, `st${bit}ate`);
      cpSync(w.state, root, { recursive: true });
      const sd = join(root, 'ten', 'session');
      const e = { ...env, GELDAR_STATE_DIR: bashPath(root) };
      const before = w.calls().length;
      const r = runBash(`${pre}start_session ten play`, { env: e });
      expect(r.status, `start ${JSON.stringify(bit)}: ${r.stderr}`).toBe(1);
      expect(r.stderr).toContain(msg);
      // Refused before anything is written or any docker call is made.
      expect(w.calls()).toHaveLength(before);
      expect(existsSync(join(sd, 'allowlist-world.txt'))).toBe(false);
      expect(existsSync(join(sd, 'override.yml'))).toBe(false);
      // The override writer refuses it on its own, too.
      const d = runBash(`${pre}write_override ten "${bashPath(sd)}" https://m.test/mcp`, {
        env: e,
      });
      expect(d.status, `override ${JSON.stringify(bit)}: ${d.stderr}`).toBe(1);
      expect(d.stderr).toContain(msg);
      expect(existsSync(join(sd, 'override.yml'))).toBe(false);
    });
  });

  it('11. a dollar sign in a path is doubled in the override and resolves back in compose', () => {
    const w = makeWorld();
    const p = player(w, 'eleven');
    const root = join(w.root, 'dollar', 'st$ate');
    cpSync(w.state, root, { recursive: true });
    const moved = { ...p, stateDir: join(root, 'eleven') };
    const extra = { ...dumpSession(w), GELDAR_STATE_DIR: bashPath(root) };
    const r = start(launcher, w, p, 'play', extra);
    expect(r.status, r.stderr).toBe(0);
    const o = text(join(sessionDir(moved), 'override.yml'));
    expect(o).toContain('st$$ate');
    expect(o).not.toMatch(/st\$ate/);
    if (!composeAvailable()) return;
    const c = composeConfig(w, moved);
    expect(c.status, c.stderr).toBe(0);
    const vols = JSON.parse(c.stdout).services.session.volumes as { source: string }[];
    const binds = vols
      .map((v) => v.source.replace(/\\/g, '/'))
      .filter((x) => x.includes('/export/'));
    expect(binds.length).toBeGreaterThan(0);
    // `config` prints a literal dollar sign as `$$`; an undoubled `$ate` would have been
    // interpolated away and the path would read /st/eleven.
    for (const b of binds) expect(b).toContain('/st$$ate/eleven/session/export/');
  });
});
