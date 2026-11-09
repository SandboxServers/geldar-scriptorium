import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitResult } from './commit.ts';
import { CommitRefusal, commitMemory, parseMode } from './commit.ts';
import { git, makeRepo } from './repo-fixture.ts';

const cleanups: (() => void)[] = [];
const restore: (() => void)[] = [];

const BASE: Record<string, string> = {
  'CLAUDE.md': 'rules\n',
  'memory/identity.md': 'name: Red\n',
  'memory/summary.md': 'day 1\n',
  'memory/people/.gitkeep': '',
};

function setEnv(key: string, value: string | undefined): void {
  const before = process.env[key];
  restore.push(() => {
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
  });
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function repo(extra: Record<string, string> = {}, playerId?: string): string {
  const made = makeRepo({ ...BASE, ...extra }, playerId);
  cleanups.push(made.cleanup);
  return made.root;
}

function write(root: string, rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function headOf(root: string): string {
  return git(root, ['rev-parse', 'HEAD']).trim();
}

function filesIn(root: string, rev = 'HEAD'): string[] {
  return git(root, ['show', '--name-only', '--format=', rev])
    .split('\n')
    .filter((l) => l !== '');
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err instanceof CommitRefusal ? err.code : 'other';
  }
}

function hasControl(text: string): boolean {
  return Array.from(text).some((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
  });
}

function canSymlink(): boolean {
  const dir = tempDir('geldar-git-probe-');
  try {
    symlinkSync(join(dir, 'target'), join(dir, 'link'));
    return true;
  } catch {
    return false;
  }
}

const SYMLINKS = canSymlink();
const POSIX = process.platform !== 'win32';

afterEach(() => {
  for (const undo of restore.splice(0).reverse()) undo();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('commitMemory', () => {
  it('stages only allowed paths and reports the rest', () => {
    const root = repo();
    write(root, 'CLAUDE.md', 'changed rules\n');
    write(root, 'memory/summary.md', 'day 2\n');
    write(root, 'memory/.gitattributes', '* text\n');
    write(root, 'skills/farm.js', 'export {};\n');
    write(root, '.mcp.json', '{}\n');

    const result = commitMemory({ root, message: 'day 2', mode: 'play' });

    expect(result.files).toEqual(['memory/summary.md', 'skills/farm.js']);
    expect(result.notSaved).toEqual(['.mcp.json', 'CLAUDE.md', 'memory/.gitattributes']);
    expect(filesIn(root)).toEqual(['memory/summary.md', 'skills/farm.js']);
    expect(git(root, ['status', '--porcelain'])).toContain(' M CLAUDE.md');
  });

  it('commits with the noreply identity even when the environment names another', () => {
    const root = repo();
    const other = repo();
    setEnv('GIT_AUTHOR_EMAIL', 'env@example.test');
    setEnv('GIT_DIR', join(other, '.git'));
    write(root, 'memory/summary.md', 'day 2\n');

    commitMemory({ root, message: 'day 2', mode: 'play' });

    const who = git(root, ['log', '-1', '--format=%an <%ae>|%cn <%ce>']).trim();
    const noreply = 'player-mmpr-red <player-mmpr-red@users.noreply.github.com>';
    expect(who).toBe(`${noreply}|${noreply}`);
  });

  it.skipIf(!POSIX)('runs no hooks', () => {
    const root = repo();
    const outside = tempDir('geldar-git-hooks-');
    for (const name of ['pre-commit', 'post-commit', 'reference-transaction']) {
      const marker = join(outside, `${name}.ran`);
      const exit = name === 'pre-commit' ? '\nexit 1\n' : '\n';
      const hook = join(root, '.git', 'hooks', name);
      writeFileSync(hook, `#!/bin/sh\necho ${name} >> '${marker}'${exit}`);
      chmodSync(hook, 0o755);
    }
    const before = headOf(root);
    write(root, 'memory/summary.md', 'day 2\n');

    commitMemory({ root, message: 'day 2', mode: 'play' });

    expect(headOf(root)).not.toBe(before);
    for (const name of ['pre-commit', 'post-commit', 'reference-transaction']) {
      expect(existsSync(join(outside, `${name}.ran`)), name).toBe(false);
    }
  });

  it('refuses with nothing_to_commit when only CLAUDE.md changed, or nothing did', () => {
    const root = repo();
    const before = headOf(root);
    write(root, 'CLAUDE.md', 'changed rules\n');

    expect(codeOf(() => commitMemory({ root, message: 'x', mode: 'play' }))).toBe(
      'nothing_to_commit',
    );
    expect(headOf(root)).toBe(before);

    write(root, 'CLAUDE.md', BASE['CLAUDE.md'] ?? '');
    expect(codeOf(() => commitMemory({ root, message: 'x', mode: 'play' }))).toBe(
      'nothing_to_commit',
    );
    expect(headOf(root)).toBe(before);
  });

  it('shortens and cleans the message, and refuses an empty one', () => {
    const root = repo();
    write(root, 'memory/summary.md', 'day 2\n');
    const message = `${'x'.repeat(50)}\u001b[31m\n${'y'.repeat(50)}`;

    commitMemory({ root, message, mode: 'play' });

    const subject = git(root, ['log', '-1', '--format=%s']).trim();
    expect(subject.length).toBeLessThanOrEqual(72);
    expect(hasControl(subject)).toBe(false);

    write(root, 'memory/summary.md', 'day 3\n');
    expect(codeOf(() => commitMemory({ root, message: '\n\u0000', mode: 'play' }))).toBe(
      'empty_message',
    );
  });

  it('keeps the identity file out in play mode and commits it in setup mode', () => {
    const root = repo();
    write(root, 'memory/identity.md', 'name: Blue\n');
    write(root, 'memory/summary.md', 'day 2\n');

    const play = commitMemory({ root, message: 'day 2', mode: 'play' });
    expect(play.files).toEqual(['memory/summary.md']);
    expect(play.notSaved).toEqual(['memory/identity.md']);

    const setup = commitMemory({ root, message: 'name', mode: 'setup' });
    expect(setup.files).toEqual(['memory/identity.md']);
  });

  it('stages a deletion of a tracked memory file', () => {
    const root = repo({ 'memory/people/x.md': 'Ana\n' });
    unlinkSync(join(root, 'memory/people/x.md'));

    const result = commitMemory({ root, message: 'forget Ana', mode: 'play' });

    expect(result.files).toEqual(['memory/people/x.md']);
    expect(git(root, ['ls-tree', '-r', '--name-only', 'HEAD'])).not.toContain('memory/people/x.md');
  });

  it.skipIf(!SYMLINKS)('does not save a symbolic link', () => {
    const root = repo();
    symlinkSync(join(root, 'CLAUDE.md'), join(root, 'memory', 'link.md'));
    write(root, 'memory/summary.md', 'day 2\n');

    const result = commitMemory({ root, message: 'day 2', mode: 'play' });

    expect(result.notSaved).toContain('memory/link.md');
    expect(filesIn(root)).toEqual(['memory/summary.md']);
  });

  it.skipIf(!SYMLINKS)('does not follow a symbolic link in a parent folder', () => {
    const root = repo();
    const outside = tempDir('geldar-git-outside-');
    writeFileSync(join(outside, 'x.md'), 'outside\n');
    rmSync(join(root, 'memory', 'people'), { recursive: true, force: true });
    symlinkSync(outside, join(root, 'memory', 'people'), 'dir');
    write(root, 'memory/summary.md', 'day 2\n');

    const outcome = (() => {
      try {
        return commitMemory({ root, message: 'day 2', mode: 'play' });
      } catch (err) {
        return err;
      }
    })();

    expect(outcome).not.toBeInstanceOf(Error);
    expect((outcome as CommitResult).notSaved).toContain('memory/people/.gitkeep');
    expect(filesIn(root)).toEqual(['memory/summary.md']);
  });

  it('refuses a bad or missing player id, and checks the session mode', () => {
    const empty = repo({}, '');
    write(empty, 'memory/summary.md', 'day 2\n');
    expect(codeOf(() => commitMemory({ root: empty, message: 'x', mode: 'play' }))).toBe(
      'no_player_id',
    );

    const broken = repo();
    write(broken, 'player.json', 'not json');
    expect(codeOf(() => commitMemory({ root: broken, message: 'x', mode: 'play' }))).toBe(
      'no_player_id',
    );

    const missing = repo();
    unlinkSync(join(missing, 'player.json'));
    expect(codeOf(() => commitMemory({ root: missing, message: 'x', mode: 'play' }))).toBe(
      'no_player_id',
    );

    expect(codeOf(() => parseMode('x'))).toBe('bad_session_mode');
    expect(parseMode(undefined)).toBe('play');
  });

  it.skipIf(!POSIX)('does not run filter drivers', () => {
    const root = repo();
    const outside = tempDir('geldar-git-filter-');
    const marker = join(outside, 'ran');
    git(root, ['config', '--local', 'filter.x.clean', `sh -c 'echo ran >> ${marker}; cat'`]);
    write(root, 'memory/.gitattributes', '* filter=x\n');
    write(root, '.git/info/attributes', '* filter=x\n');
    const past = new Date('2001-01-01T00:00:00Z');
    write(root, 'memory/summary.md', 'day 2 (rewritten)\n');
    utimesSync(join(root, 'memory/summary.md'), past, past);
    write(root, 'memory/notes.md', 'a note\n');

    commitMemory({ root, message: 'day 2', mode: 'play' });

    expect(existsSync(marker)).toBe(false);
    expect(git(root, ['cat-file', '-p', 'HEAD:memory/summary.md'])).toBe('day 2 (rewritten)\n');
  });

  it.skipIf(!POSIX)('commits a new file as 100644 even when it is executable', () => {
    const root = repo();
    write(root, 'memory/exec.md', 'run\n');
    chmodSync(join(root, 'memory/exec.md'), 0o755);

    commitMemory({ root, message: 'exec', mode: 'play' });

    expect(git(root, ['ls-tree', 'HEAD', 'memory/exec.md'])).toMatch(/^100644 blob /);
  });

  it('drops changes that were already staged with git add', () => {
    const root = repo();
    write(root, 'CLAUDE.md', 'changed rules\n');
    git(root, ['add', 'CLAUDE.md']);
    write(root, 'memory/summary.md', 'day 2\n');

    const result = commitMemory({ root, message: 'day 2', mode: 'play' });

    expect(result.files).toEqual(['memory/summary.md']);
    expect(filesIn(root)).toEqual(['memory/summary.md']);
  });

  it.skipIf(!POSIX)('does not let odd file names block the save', () => {
    const root = repo();
    write(root, 'memory/"x".md', 'odd\n');
    const canLock = typeof process.getuid === 'function' && process.getuid() !== 0;
    if (canLock) {
      write(root, 'memory/locked.md', 'locked\n');
      chmodSync(join(root, 'memory/locked.md'), 0o000);
    }
    write(root, 'memory/summary.md', 'day 2\n');

    const result = commitMemory({ root, message: 'day 2', mode: 'play' });

    expect(filesIn(root)).toEqual(['memory/summary.md']);
    expect(result.notSaved).toContain('memory/"x".md');
    if (canLock) expect(result.notSaved).toContain('memory/locked.md');
  });
});
