import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  forGroup,
  git,
  type Launcher,
  makePlayer,
  makeWorld,
  type Player,
  run,
  type World,
} from '../harness.ts';
import { expectNoDockerCall, expectRefusal } from './world.ts';

// SC-60c, H-04 (T-04): the kit export is START's own bytes, not the working tree.
const T = 120_000;
const gitEnv = (w: World) => ({ GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') });
const prep = (l: Launcher, w: World) =>
  run(l, ['__prepare', 'abc', 'play'], {
    env: l.name === 'bash' ? w.env : w.envPwsh,
    timeoutMs: T,
  });

function commit(w: World, p: Player, files: Record<string, string>) {
  for (const [f, body] of Object.entries(files)) writeFileSync(join(p.clone, f), body);
  git(p.clone, ['add', '-A'], gitEnv(w));
  git(p.clone, ['commit', '-q', '-m', 'hostile'], gitEnv(w));
}

const blobAt = (p: Player, rev: string, path: string): Buffer =>
  spawnSync('git', ['cat-file', 'blob', `${rev}:${path}`], { cwd: p.clone }).stdout;

// Every kit path of START (everything outside memory/ and skills/) is in export/ byte for byte.
function expectKitEqualsStart(p: Player, start: string) {
  const out = git(p.clone, ['ls-tree', '-r', '--name-only', start]);
  const kit = out.split('\n').filter((f) => !/^(memory|skills)\//.test(f));
  expect(kit).toContain('CLAUDE.md');
  for (const f of kit) {
    const exported = join(p.stateDir, 'session', 'export', f);
    expect(existsSync(exported), `${f} is missing from the export`).toBe(true);
    expect(readFileSync(exported).equals(blobAt(p, start, f)), `${f} differs from START`).toBe(
      true,
    );
  }
}

describe.each(forGroup('hostile'))('H-04 export ($name)', (launcher) => {
  it('a change hidden by skip-worktree is not in the export', { timeout: T }, () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'abc' });
    git(p.clone, ['update-index', '--skip-worktree', 'CLAUDE.md'], gitEnv(w));
    writeFileSync(join(p.clone, 'CLAUDE.md'), 'hidden edit\n');
    expect(git(p.clone, ['status', '--porcelain', '--untracked-files=all'])).toBe('');
    const r = prep(launcher, w);
    expect(r.status, r.stderr).toBe(0);
    const start = git(p.clone, ['rev-parse', 'HEAD']);
    expect(readFileSync(join(p.stateDir, 'session', 'export', 'CLAUDE.md'), 'utf8')).not.toContain(
      'hidden edit',
    );
    expectKitEqualsStart(p, start);
  });

  // S4: git archive honours the tree's own .gitattributes (export-ignore drops CLAUDE.md,
  // export-subst rewrites it), so prepare refuses such a START before exporting anything.
  it('START with CLAUDE.md export-ignore is refused (export_attributes)', { timeout: T }, () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'abc' });
    commit(w, p, { '.gitattributes': 'CLAUDE.md export-ignore\n' });
    const r = prep(launcher, w);
    expectRefusal(r, 'export_attributes', { status: 1 });
    expectNoDockerCall(w);
  });

  it('START with CLAUDE.md export-subst is refused (export_attributes)', { timeout: T }, () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'abc' });
    commit(w, p, {
      '.gitattributes': 'CLAUDE.md export-subst\n',
      'CLAUDE.md': 'commit $Format:%H$\n',
    });
    const r = prep(launcher, w);
    expectRefusal(r, 'export_attributes', { status: 1 });
    expectNoDockerCall(w);
  });

  it('a .gitattributes without an export attribute does not block START', { timeout: T }, () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'abc' });
    commit(w, p, { '.gitattributes': '* text=auto\n' });
    const r = prep(launcher, w);
    expect(r.status, r.stderr).toBe(0);
  });

  it('a START where CLAUDE.md is a symlink is refused (export_symlink)', { timeout: T }, () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'abc' });
    const g = gitEnv(w);
    const hashed = spawnSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: p.clone,
      input: join(w.root, 'target'),
      encoding: 'utf8',
      env: { ...process.env, ...g },
    }).stdout.trim();
    git(p.clone, ['rm', '-q', '--cached', 'CLAUDE.md'], g);
    git(p.clone, ['update-index', '--add', '--cacheinfo', `120000,${hashed},CLAUDE.md`], g);
    git(p.clone, ['commit', '-q', '-m', 'link'], g);
    git(p.clone, ['checkout', '-f', '--', 'CLAUDE.md'], g);
    git(p.clone, ['clean', '-fdxq'], g);
    const r = prep(launcher, w);
    expectRefusal(r, 'export_symlink', { status: 1 });
    expectNoDockerCall(w);
  });
});
