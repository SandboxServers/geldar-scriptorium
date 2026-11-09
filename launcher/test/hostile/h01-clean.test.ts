import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
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
import { expectHostUnchanged, expectNoDockerCall, expectRefusal, snapshotHost } from './world.ts';

// SC-60c, H-01 (T-01): a clone that is not clean is refused before any docker call.
const win = process.platform === 'win32';
const T = 120_000;
const envOf = (l: Launcher, w: World) => (l.name === 'bash' ? w.env : w.envPwsh);
const gitEnv = (w: World) => ({ GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') });

function blob(w: World, p: Player, body: string): string {
  const r = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: p.clone,
    input: body,
    encoding: 'utf8',
    env: { ...process.env, ...gitEnv(w) },
  });
  return r.stdout.trim();
}

// These names cannot be created on NTFS: stage them straight into the index (Linux only: git for
// Windows refuses them even with --cacheinfo; unverified locally, CI decides).
const staged = (w: World, p: Player, name: string) =>
  git(
    p.clone,
    ['update-index', '--add', '--cacheinfo', `100644,${blob(w, p, 'x\n')},${name}`],
    gitEnv(w),
  );

const rows: { name: string; skip?: boolean; make: (w: World, p: Player) => void }[] = [
  { name: 'an untracked file', make: (_w, p) => writeFileSync(join(p.clone, 'new.txt'), 'x') },
  {
    name: 'a staged-only change',
    make: (w, p) => {
      writeFileSync(join(p.clone, 'memory', 's.md'), 'x');
      git(p.clone, ['add', 'memory/s.md'], gitEnv(w));
    },
  },
  {
    name: 'a modified tracked file',
    make: (_w, p) => writeFileSync(join(p.clone, 'CLAUDE.md'), 'changed\n'),
  },
  { name: 'a staged file name with a newline', make: (w, p) => staged(w, p, 'memory/a\nb.md') },
  { name: 'a staged file name with a quote', make: (w, p) => staged(w, p, 'memory/a"b.md') },
  {
    name: 'a working-tree file name with a newline [skipped on win32: NTFS cannot hold it]',
    skip: win,
    make: (_w, p) => writeFileSync(join(p.clone, 'memory', 'a\nb.md'), 'x'),
  },
  {
    name: 'a working-tree file name with a quote [skipped on win32: NTFS cannot hold it]',
    skip: win,
    make: (_w, p) => writeFileSync(join(p.clone, 'memory', 'a"b.md'), 'x'),
  },
  {
    name: 'a merge in progress (merge --no-commit leaves staged changes)',
    make: (w, p) => {
      const g = (...a: string[]) => git(p.clone, a, gitEnv(w));
      g('checkout', '-q', '-b', 'side');
      writeFileSync(join(p.clone, 'memory', 'side.md'), 's\n');
      g('add', '-A');
      g('commit', '-q', '-m', 'side');
      g('checkout', '-q', 'main');
      writeFileSync(join(p.clone, 'memory', 'main.md'), 'm\n');
      g('add', '-A');
      g('commit', '-q', '-m', 'main');
      g('merge', '--no-commit', '--no-ff', 'side');
    },
  },
  {
    name: 'a staged mode-only change',
    make: (w, p) => git(p.clone, ['update-index', '--chmod=+x', 'CLAUDE.md'], gitEnv(w)),
  },
  {
    name: 'a working-tree mode-only change [skipped on win32: no file modes]',
    skip: win,
    make: (w, p) => {
      git(p.clone, ['config', 'core.fileMode', 'true'], gitEnv(w));
      chmodSync(join(p.clone, 'CLAUDE.md'), 0o755);
    },
  },
];

describe.each(forGroup('hostile'))('H-01 clean clone ($name)', (launcher) => {
  it('control: a clean clone proceeds', { timeout: T }, () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'abc' });
    const r = run(launcher, ['__prepare', 'abc', 'play'], {
      env: envOf(launcher, w),
      timeoutMs: T,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(p.stateDir, 'session', 'running'))).toBe(true);
  });

  for (const row of rows) {
    (row.skip ? it.skip : it)(`refuses ${row.name}`, { timeout: T }, () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      row.make(w, p);
      const before = snapshotHost(w, p);
      const r = run(launcher, ['__prepare', 'abc', 'play'], {
        env: envOf(launcher, w),
        timeoutMs: T,
      });
      expectRefusal(r, 'dirty', { status: 1 });
      expectNoDockerCall(w);
      expect(existsSync(join(p.stateDir, 'start'))).toBe(false);
      expectHostUnchanged(before, snapshotHost(w, p));
    });
  }
});
