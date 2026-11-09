// End to end through real containers (SC-55b): the real launcher, the compose project with the
// real Squid, the stub variant of the kit image, an in-test world and a real geldar-verify.
// Only `gh` is faked. Heavy: it builds two images and starts containers, so locally it runs only
// with GELDAR_E2E=1 (CI always runs it). Needs Linux containers.
//   GELDAR_E2E=1 KIT_IMAGE=geldar-kit:sc-55b ./scriptorium.ps1 pnpm vitest run tests/e2e
// Both launchers run, bash where bash exists and PowerShell where pwsh exists; in CI a missing
// shell fails the run.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bashPath, type Launcher, launchers, repoRoot, run } from '../../launcher/test/harness.ts';
import { parseScenario } from '../../packages/stub-cli/src/scenario.ts';
import { buildKit, dockerReady, KIT_IMAGE } from '../image/docker.ts';
import { cleanPlayer, docker, writeExtraCompose } from './world.ts';

const SCEN = 'packages/stub-cli/src/scenarios';
const IN_IMAGE = '/opt/geldar-stub/packages/stub-cli/src/scenarios';
const gate = process.env.GELDAR_E2E === '1' || Boolean(process.env.CI);
const win = process.platform === 'win32';
const STUB_IMAGE = `geldar-kit-stub:e2e-${process.pid}`;
const PLAY = [1, 2, 3];

describe('e2e scenarios', () => {
  it('all scenarios parse', () => {
    for (const f of ['birth', 'play-day-1', 'play-day-2', 'play-day-3', 'stray-file']) {
      const text = readFileSync(join(repoRoot, SCEN, `${f}.jsonl`), 'utf8');
      expect(() => parseScenario(text), f).not.toThrow();
    }
  });
});

function git(prefix: string[], args: string[]): string {
  const r = spawnSync('git', [...prefix, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: win ? 'NUL' : '/dev/null' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
const gitDir = (dir: string, args: string[]): string => git(['--git-dir', dir], args);
const gitIn = (dir: string, args: string[]): string => git(['-C', dir], args);

const token = randomBytes(24).toString('base64url');
const ready = gate && dockerReady();
const outputs: string[] = [];
const allIds: { id: string; vols: string[] }[] = [];

beforeAll(() => {
  if (!ready) return;
  buildKit();
  const r = spawnSync(
    'docker',
    [
      'build',
      '-f',
      'image/stub.Dockerfile',
      '--build-arg',
      `KIT_BASE=${KIT_IMAGE}`,
      '-t',
      STUB_IMAGE,
      '.',
    ],
    { cwd: repoRoot, encoding: 'utf8', timeout: 900_000 },
  );
  if (r.status !== 0) throw new Error(`stub image build failed: ${r.stderr}`);
}, 900_000);

afterAll(() => {
  if (!ready) return;
  for (const p of allIds) cleanPlayer(p.id, p.vols);
  docker(['rmi', STUB_IMAGE]);
}, 120_000);

describe.each(['bash', 'pwsh'] as const)('end to end (%s)', (name) => {
  const found: Launcher | undefined = launchers.find((x) => x.name === name);
  if (!found) {
    it('the shell is installed', () => {
      if (process.env.CI) throw new Error(`${name} is required in CI`);
    });
    return;
  }
  const launcher: Launcher = found;
  const bash = name === 'bash';
  const p = (x: string): string => (bash ? bashPath(x) : x);
  const root = mkdtempSync(join(tmpdir(), `e2e-${name}-`));
  const state = join(root, 'state');
  const players = join(root, 'players');
  const ghRoot = join(root, 'gh');
  const fakeDir = join(root, 'fake');
  for (const d of [state, players, ghRoot, fakeDir]) mkdirSync(d, { recursive: true });
  const tokenFile = join(root, 'token');
  writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  const gitconfig = join(root, 'gitconfig');
  writeFileSync(gitconfig, '[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n');
  const fakeGh = join(repoRoot, 'launcher', 'test', 'fake-gh.sh');
  writeFileSync(join(fakeDir, 'gh'), `#!/bin/sh\nexec sh "${bashPath(fakeGh)}" "$@"\n`);
  chmodSync(join(fakeDir, 'gh'), 0o755);
  // Git bash on Windows rewrites /c/... in docker arguments wrongly for -v (not for compose -f); Docker Desktop reads /c/... as it is.
  writeFileSync(
    join(fakeDir, 'docker'),
    ['#!/bin/sh', '[ "$1" = compose ] || export MSYS_NO_PATHCONV=1', 'exec docker "$@"', ''].join(
      '\n',
    ),
  );
  chmodSync(join(fakeDir, 'docker'), 0o755);
  if (win) writeFileSync(join(fakeDir, 'gh.cmd'), `@sh "${bashPath(fakeGh)}" %*\r\n`);
  const suffix = `${bash ? 'b' : 'p'}${process.pid}`;

  // One player: its own id, scenario folder, extra compose file and environment.
  function player(tag: string) {
    const id = `e2e${tag}${suffix}`;
    const scen = join(root, `scen-${tag}`);
    mkdirSync(scen, { recursive: true });
    const extra = writeExtraCompose({ dir: scen, image: STUB_IMAGE, scenarioDir: scen, id });
    allIds.push({ id, vols: [extra.proxyLogVolume] });
    const env = (scenario?: string): Record<string, string> => ({
      GELDAR_STATE_DIR: p(state),
      GELDAR_PLAYERS_DIR: p(players),
      ...(bash ? { GELDAR_DOCKER: bashPath(join(fakeDir, 'docker')) } : {}),
      GELDAR_GH: p(join(fakeDir, win && !bash ? 'gh.cmd' : 'gh')),
      FAKE_GH_ROOT: bashPath(ghRoot),
      FAKE_GH_TEMPLATE: bashPath(join(repoRoot, 'template')),
      GIT_CONFIG_GLOBAL: p(gitconfig),
      MSYS2_ENV_CONV_EXCL: 'GELDAR_STUB_SCENARIO',
      GELDAR_INTERNAL: '1',
      GELDAR_UNSAFE_IMAGE: '1',
      GELDAR_KIT_IMAGE: STUB_IMAGE,
      GELDAR_EXTRA_COMPOSE: extra.file,
      E2E_WORLD_TOKEN: token,
      ...(scenario ? { GELDAR_STUB_SCENARIO: scenario } : {}),
    });
    const go = (args: string[], scenario?: string, timeoutMs = 280_000) => {
      const r = run(launcher, args, { env: env(scenario), timeoutMs });
      outputs.push(r.stdout, r.stderr);
      return r;
    };
    const origin = join(ghRoot, `player-${id}.git`);
    const clone = join(players, `player-${id}`);
    const newPlayer = () =>
      go(
        ['new', id, '--mock', 'http://world.test', '--token-file', p(tokenFile)],
        undefined,
        55_000,
      );
    const birth = () => go(['setup', id], `${IN_IMAGE}/birth.jsonl`);
    return { id, scen, extra, go, origin, clone, newPlayer, birth };
  }

  // The commits after the launcher's own `player: <id>` commit, oldest first.
  const afterLauncher = (origin: string, id: string) => {
    const base = gitDir(origin, ['log', '--format=%H', `--grep=^player: ${id}$`, 'main']).trim();
    const rows = gitDir(origin, [
      'log',
      '--reverse',
      '--format=%H%x09%an <%ae>%x09%cn <%ce>%x09%s',
      `${base}..main`,
    ]);
    return rows
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha = '', author = '', committer = '', subject = ''] = line.split('\t');
        return { sha, author, committer, subject };
      });
  };

  describe('new, setup and three play days', () => {
    const a = player('a');

    it('new creates the player', { timeout: 60_000 }, () => {
      if (!ready) return;
      const r = a.newPlayer();
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(join(a.clone, 'player.json'))).toBe(true);
    });

    it('setup runs the birth session', { timeout: 300_000 }, () => {
      if (!ready) return;
      const r = a.birth();
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout + r.stderr).toContain('UNSAFE:');
    });

    for (const n of PLAY) {
      it(`play day ${n}`, { timeout: 300_000 }, () => {
        if (!ready) return;
        const r = a.go(['play', a.id], `${IN_IMAGE}/play-day-${n}.jsonl`);
        expect(r.status, r.stdout + r.stderr).toBe(0);
      });
    }

    it('origin holds exactly the four commits, by the player, memory only', () => {
      if (!ready) return;
      const commits = afterLauncher(a.origin, a.id);
      const who = `player-${a.id} <player-${a.id}@users.noreply.github.com>`;
      expect(commits.map((c) => c.subject)).toEqual([
        'birth: Wren',
        'day 001: quiet',
        'day 002: quiet',
        'day 003: quiet',
      ]);
      commits.forEach((c, i) => {
        expect(c.author).toBe(who);
        expect(c.committer).toBe(who);
        const files = gitDir(a.origin, ['diff-tree', '--no-commit-id', '--name-only', '-r', c.sha])
          .split('\n')
          .filter(Boolean);
        expect(files.length).toBeGreaterThan(0);
        for (const f of files) expect(f.startsWith('memory/'), f).toBe(true);
        expect(files.includes('memory/identity.md')).toBe(i === 0);
      });
      const tree = gitDir(a.origin, ['ls-tree', '-r', '--name-only', 'main']).split('\n');
      for (const n of PLAY) expect(tree).toContain(`memory/journal/day-00${n}.md`);
    });

    it('the host clone is clean and equals origin; volumes are right', () => {
      if (!ready) return;
      expect(gitIn(a.clone, ['status', '--porcelain', '--untracked-files=all']).trim()).toBe('');
      expect(gitIn(a.clone, ['rev-parse', 'HEAD']).trim()).toBe(
        gitDir(a.origin, ['rev-parse', 'main']).trim(),
      );
      const vols = docker(['volume', 'ls', '-q']).stdout.split(/\s+/);
      expect(vols).not.toContain(`geldar-ws-${a.id}`);
      expect(vols).toContain(`geldar-cli-${a.id}-claude`);
    });

    it('the proxy allowed the world and denied nothing', () => {
      if (!ready) return;
      const mount = `${a.extra.proxyLogVolume}:/l:ro`;
      const log = docker([
        'run',
        '--rm',
        '--user',
        '0',
        '-v',
        mount,
        STUB_IMAGE,
        'cat',
        '/l/access.log',
      ]);
      expect(log.status, log.stderr).toBe(0);
      const lines = log.stdout.split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      expect(log.stdout).not.toContain('DENIED');
      for (const line of lines) expect(line, line).toContain('world.test');
      outputs.push(log.stdout);
    });

    it('the token is nowhere it should not be', () => {
      if (!ready) return;
      expect(outputs.join('\n')).not.toContain(token);
      expect(gitDir(a.origin, ['log', '--all', '-p'])).not.toContain(token);
    });
  });

  describe('the negative twin', () => {
    const t = player('t');

    it('a stray file is not saved and never reaches origin', { timeout: 600_000 }, () => {
      if (!ready) return;
      expect(t.newPlayer().status).toBe(0);
      expect(t.birth().status).toBe(0);
      const before = gitDir(t.origin, ['show', 'main:CLAUDE.md']);
      const r = t.go(['play', t.id], `${IN_IMAGE}/stray-file.jsonl`);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const tree = gitDir(t.origin, ['ls-tree', '-r', '--name-only', 'main']).split('\n');
      expect(tree).not.toContain('stray.txt');
      expect(tree).toContain('memory/journal/day-001.md');
      expect(gitDir(t.origin, ['show', 'main:CLAUDE.md'])).toBe(before);
      const changed = gitDir(t.origin, ['log', '--name-only', '--format=', '-n', '2', 'main']);
      expect(changed).not.toContain('CLAUDE.md');
    });
  });

  describe('the real bundle cap', () => {
    const z = player('z');

    it('an oversized bundle is cut and held', { timeout: 600_000 }, () => {
      if (!ready) return;
      expect(z.newPlayer().status).toBe(0);
      expect(z.birth().status).toBe(0);
      const big = randomBytes(56 * 1024 * 1024).toString('base64url');
      const lines = [
        { op: 'write', path: 'memory/journal/big.md', content: big },
        {
          op: 'call',
          server: 'geldar_git',
          tool: 'commit_memory',
          args: { message: 'day 001: big' },
          expect: { includes: ['memory/journal/big.md'] },
        },
      ];
      const text = lines.map((x) => JSON.stringify(x)).join('\n');
      writeFileSync(join(z.scen, 'big.jsonl'), `${text}\n`);
      const r = z.go(['play', z.id], '/e2e-scen/big.jsonl');
      expect(r.status, r.stdout + r.stderr).toBe(3);
      const info = readFileSync(join(state, z.id, 'held', 'info'), 'utf8');
      expect(info).toContain('reason=bundle_too_large');
      const ps = docker([
        'ps',
        '-a',
        '--filter',
        'label=geldar.role=bundle',
        '--format',
        '{{.Names}}',
      ]);
      expect(ps.stdout).not.toContain(`geldar-bundle-${z.id}-`);
      const override = join(state, z.id, 'session', 'override.yml');
      if (existsSync(override)) expect(readFileSync(override, 'utf8')).not.toContain(token);
      expect(r.stdout + r.stderr).not.toContain(token);
    });
  });
});
