// corpus: MB-01 MB-02 MB-03 MB-04 MB-05 MB-06 MB-07 MB-08 MB-09
// The world side of the malicious-book corpus, end to end (SC-61h): the real launcher, the real
// Squid, the stub kit image and the geldar mock image started on each corpus scenario. The stub
// reads the book and checks with its own expect.includes that the canary arrived; it never obeys.
// This proves the plumbing and the image content, not a defence. Heavy: GELDAR_E2E=1 (CI always).
//   GELDAR_E2E=1 KIT_IMAGE=geldar-kit:sc-61h ./scriptorium.ps1 pnpm vitest run tests/e2e/malicious-world.test.ts
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bashPath, launchers, repoRoot, run } from '../../launcher/test/harness.ts';
import { corpusReadScenario } from '../../packages/stub-cli/src/corpus-scenario.ts';
import { manifest } from '../hostile/corpus/corpus.ts';
import { buildKit, dockerReady, KIT_IMAGE } from '../image/docker.ts';
import { cleanPlayer, docker, MOCK_IMAGE, writeExtraCompose } from './world.ts';

const gate = process.env.GELDAR_E2E === '1' || Boolean(process.env.CI);
const win = process.platform === 'win32';
const ready = gate && dockerReady();
const STUB_IMAGE = `geldar-kit-stub:mw-${process.pid}`;
const MAL = '/opt/geldar/threshold/mcp-mock/scenarios/malicious';
const BIRTH = '/opt/geldar-stub/packages/stub-cli/src/scenarios/birth.jsonl';

interface IndexRow {
  id: string;
  file: string;
  canary: string;
  book_id: string;
  read_tool: string;
}
let index: IndexRow[] = [];
const outputs: string[] = [];
const created: { id: string; vols: string[] }[] = [];
const token = randomBytes(24).toString('base64url');

function git(args: string[]): string {
  const r = spawnSync('git', args, {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: win ? 'NUL' : '/dev/null' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

beforeAll(() => {
  if (!ready) return;
  buildKit();
  const pull = docker(['pull', MOCK_IMAGE], 600_000);
  if (pull.status !== 0) throw new Error(`mock image pull failed: ${pull.stderr}`);
  // The index comes out of the image itself, so the image content is proved too.
  const cat = docker(['run', '--rm', '--entrypoint', 'cat', MOCK_IMAGE, `${MAL}/corpus.json`]);
  if (cat.status !== 0) throw new Error(`corpus.json missing from the image: ${cat.stderr}`);
  index = JSON.parse(cat.stdout);
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
  for (const p of created) cleanPlayer(p.id, p.vols);
  docker(['rmi', STUB_IMAGE]);
}, 120_000);

const launcher = launchers.find((x) => x.name === 'bash');
describe.runIf(Boolean(launcher) || Boolean(process.env.CI))(
  'malicious books, world side (bash)',
  () => {
    if (!launcher) {
      it('bash is installed', () => {
        throw new Error('bash is required in CI');
      });
      return;
    }
    const l = launcher;
    const root = mkdtempSync(join(tmpdir(), 'mw-'));
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
    writeFileSync(
      join(fakeDir, 'docker'),
      ['#!/bin/sh', '[ "$1" = compose ] || export MSYS_NO_PATHCONV=1', 'exec docker "$@"', ''].join(
        '\n',
      ),
    );
    chmodSync(join(fakeDir, 'docker'), 0o755);

    describe.each(manifest.map((m) => m.id))('%s', (mbId) => {
      const id = `mw${mbId.slice(3)}p${process.pid}`;
      const origin = join(ghRoot, `player-${id}.git`);
      const scen = join(root, `scen-${mbId}`);
      mkdirSync(scen, { recursive: true });

      function go(args: string[], scenario?: string, timeoutMs = 280_000) {
        const r = run(l, args, {
          timeoutMs,
          env: {
            GELDAR_STATE_DIR: bashPath(state),
            GELDAR_PLAYERS_DIR: bashPath(players),
            GELDAR_DOCKER: bashPath(join(fakeDir, 'docker')),
            GELDAR_GH: bashPath(join(fakeDir, 'gh')),
            FAKE_GH_ROOT: bashPath(ghRoot),
            FAKE_GH_TEMPLATE: bashPath(join(repoRoot, 'template')),
            GIT_CONFIG_GLOBAL: bashPath(gitconfig),
            MSYS2_ENV_CONV_EXCL: 'GELDAR_STUB_SCENARIO',
            GELDAR_INTERNAL: '1',
            GELDAR_UNSAFE_IMAGE: '1',
            GELDAR_KIT_IMAGE: STUB_IMAGE,
            GELDAR_EXTRA_COMPOSE: join(scen, 'extra.yml').split('\\').join('/'),
            E2E_WORLD_TOKEN: token,
            ...(scenario ? { GELDAR_STUB_SCENARIO: scenario } : {}),
          },
        });
        outputs.push(r.stdout, r.stderr);
        return r;
      }

      it('the stub reads the book through the image and the canary arrives', {
        timeout: 900_000,
      }, () => {
        if (!ready) return;
        const row = index.find((r) => r.id === mbId);
        expect(row, `${mbId} missing from corpus.json in the image`).toBeDefined();
        if (!row) return;
        const entry = manifest.find((m) => m.id === mbId);
        if (!entry) throw new Error(`${mbId} not in the manifest`);
        expect(row.canary).toBe(entry.canary);
        const tokensFile = join(scen, 'mcp-tokens.json');
        writeFileSync(tokensFile, JSON.stringify({ [id]: token }));
        chmodSync(tokensFile, 0o644);
        const extra = writeExtraCompose({
          dir: scen,
          image: STUB_IMAGE,
          scenarioDir: scen,
          id,
          tokensFile,
          mockScenario: `scenarios/malicious/${row.file}`,
        });
        created.push({ id, vols: [extra.proxyLogVolume] });
        writeFileSync(join(scen, 'read.jsonl'), corpusReadScenario(row));

        const made = go(
          ['new', id, '--mock', 'http://world.test', '--token-file', bashPath(tokenFile)],
          undefined,
          55_000,
        );
        expect(made.status, made.stderr).toBe(0);
        const birth = go(['setup', id], BIRTH);
        expect(birth.status, birth.stdout + birth.stderr).toBe(0);
        const r = go(['play', id], '/e2e-scen/read.jsonl');
        const out = r.stdout + r.stderr;
        // The stub exits 0 only if every step passed, the canary step included.
        expect(r.status, out).toBe(0);
        expect(r.stdout, out).toContain('step 1 call ok');
        expect(r.stdout, out).not.toContain('FAIL');

        // Saved or nothing to save: origin holds the birth commit and nothing outside memory/
        // came after the launcher's own commit.
        const base = git([
          '--git-dir',
          origin,
          'log',
          '--format=%H',
          `--grep=^player: ${id}$`,
          'main',
        ]).trim();
        const subjects = git([
          '--git-dir',
          origin,
          'log',
          '--reverse',
          '--format=%s',
          `${base}..main`,
        ])
          .split('\n')
          .filter(Boolean);
        expect(subjects).toEqual(['birth: Wren']);
        const files = git(['--git-dir', origin, 'log', '--name-only', '--format=', `${base}..main`])
          .split('\n')
          .filter(Boolean);
        for (const f of files) expect(f.startsWith('memory/'), f).toBe(true);
        const patch = git(['--git-dir', origin, 'log', '-p', '--format=', `${base}..main`]);
        for (const m of entry.forbidden_markers) expect(patch, m).not.toContain(m);

        const mount = `${extra.proxyLogVolume}:/l:ro`;
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
        expect(outputs.join('\n')).not.toContain(token);
      });
    });
  },
);
