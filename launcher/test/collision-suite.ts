import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { bashPath, git, type Launcher, makeWorld, repoRoot, runLib } from './harness.ts';

export interface CollisionRow {
  name: string;
  start: string[] | 'GEN200';
  add: string[];
  delete?: string[];
  collides: boolean;
  launcher?: false;
  pathRuleRejects?: true;
}

const libDir = bashPath(join(repoRoot, 'launcher', 'lib'));
const author = {
  GIT_AUTHOR_NAME: 'p',
  GIT_AUTHOR_EMAIL: 'p@example.test',
  GIT_COMMITTER_NAME: 'p',
  GIT_COMMITTER_EMAIL: 'p@example.test',
};
const TSV_KEY = 'recheck_case_collision';

export function loadRows(): CollisionRow[] {
  return JSON.parse(readFileSync(join(repoRoot, 'launcher/test/collision-cases.json'), 'utf8'));
}

export function startPaths(row: CollisionRow): string[] {
  if (row.start !== 'GEN200') return row.start;
  return Array.from({ length: 200 }, (_, i) => `memory/n${String(i).padStart(3, '0')}.md`);
}

export function collisionText(): string {
  const tsv = readFileSync(join(repoRoot, 'launcher/messages.d/53-collision.tsv'), 'utf8');
  const line = tsv.split('\n').find((l) => l.startsWith(`${TSV_KEY}\t`));
  if (!line) throw new Error(`${TSV_KEY} is missing from 53-collision.tsv`);
  return line.slice(TSV_KEY.length + 1);
}

// Builds the start and end trees with git plumbing, so a case-insensitive file system keeps
// both spellings (no working-tree checkout is involved).
export function buildCollisionRepo(row: CollisionRow, dir: string) {
  mkdirSync(dir, { recursive: true });
  const cfg = join(dir, '..', 'gitconfig-collision');
  writeFileSync(cfg, '');
  const env = { ...author, GIT_CONFIG_GLOBAL: cfg };
  const g = (...a: string[]) => git(dir, a, env);
  g('init', '-q', '-b', 'main');
  const blob = (text: string) => {
    const r = spawnSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: dir,
      encoding: 'utf8',
      input: text,
      env: { ...process.env, ...env },
    });
    if (r.status !== 0) throw new Error(`hash-object failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const put = (p: string, text: string) =>
    g('update-index', '--add', '--cacheinfo', `100644,${blob(text)},${p}`);
  for (const p of startPaths(row)) put(p, `${p}\n`);
  const start = g('commit-tree', g('write-tree'), '-m', 'start');
  for (const p of row.delete ?? []) g('update-index', '--force-remove', p);
  for (const p of row.add) put(p, `${p} end\n`);
  const ref = g('commit-tree', g('write-tree'), '-p', start, '-m', 'end');
  return { dir, start, ref };
}

export function runRecheck(
  launcher: Launcher,
  repo: { dir: string; start: string; ref: string },
  mode = 'play',
): { ok: boolean; why: string } {
  const w = makeWorld();
  const d = bashPath(repo.dir);
  const r = runLib(
    launcher,
    {
      bash: `. '${libDir}/recheck.sh'; host_recheck '${d}' ${repo.start} ${repo.ref} ${mode}; echo "rc=$? why=$RC_WHY"`,
      pwsh: `. (Join-Path $GP_DIR 'lib/recheck.ps1')
$ok = Test-HostRecheck '${d}' '${repo.start}' '${repo.ref}' '${mode}'
[Console]::Out.Write("rc=$([int](-not $ok)) why=$script:RC_WHY\`n")`,
    },
    { env: launcher.name === 'bash' ? w.env : w.envPwsh },
  );
  const m = /rc=(\d+) why=(.*)/s.exec(r.stdout.trim());
  if (!m) throw new Error(`unreadable recheck output: ${r.stdout} ${r.stderr}`);
  return { ok: m[1] === '0', why: m[2] ?? '' };
}

export function collisionSuite(launcher: Launcher): void {
  const text = collisionText();
  for (const row of loadRows().filter((r) => r.launcher !== false)) {
    it(`${launcher.name}: ${row.name}`, () => {
      const w = makeWorld();
      const repo = buildCollisionRepo(row, join(w.root, 'collision-repo'));
      const res = runRecheck(launcher, repo);
      expect(res.ok, res.why).toBe(!row.collides);
      if (row.collides && !row.pathRuleRejects) {
        expect(res.why).toContain(text);
        expect(Array.from(res.why).every((c) => c.charCodeAt(0) >= 32)).toBe(true);
      }
    }, 60_000);
  }
}
