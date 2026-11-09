import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HashRefusal, hashRegularFile, MAX_FILE_BYTES } from './hash-file.ts';
import { git } from './repo-fixture.ts';

const win = process.platform === 'win32';
const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-hash-'));
  dirs.push(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  return dir;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof HashRefusal) return err.code;
    throw err;
  }
  return undefined;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('hashRegularFile', () => {
  it('gives the same sha as git hash-object', () => {
    const root = tmp();
    writeFileSync(join(root, 'a.md'), 'hello\r\nworld\n');
    const expected = git(root, ['hash-object', '--no-filters', 'a.md']).trim();
    expect(hashRegularFile(root, join(root, 'a.md'), { write: false })).toBe(expected);
    expect(hashRegularFile(root, join(root, 'a.md'), { write: true })).toBe(expected);
    expect(git(root, ['cat-file', '-t', expected]).trim()).toBe('blob');
  });

  it.skipIf(win)('refuses a symlink to a regular file', () => {
    const root = tmp();
    writeFileSync(join(root, 'secret'), 'CANARY');
    symlinkSync(join(root, 'secret'), join(root, 'link.md'));
    expect(codeOf(() => hashRegularFile(root, join(root, 'link.md'), { write: true }))).toBe(
      'symlink',
    );
  });

  it('refuses a hard-linked file', () => {
    const root = tmp();
    writeFileSync(join(root, 'a.md'), 'x');
    linkSync(join(root, 'a.md'), join(root, 'b.md'));
    expect(codeOf(() => hashRegularFile(root, join(root, 'b.md'), { write: true }))).toBe(
      'hard_linked',
    );
  });

  it('refuses a directory', () => {
    const root = tmp();
    mkdirSync(join(root, 'd'));
    expect(codeOf(() => hashRegularFile(root, join(root, 'd'), { write: true }))).toBe(
      'not_regular',
    );
  });

  it.skipIf(win)('refuses a FIFO', () => {
    const root = tmp();
    expect(spawnSync('mkfifo', [join(root, 'p')]).status).toBe(0);
    expect(codeOf(() => hashRegularFile(root, join(root, 'p'), { write: true }))).toBe(
      'not_regular',
    );
  });

  it('refuses a file over the cap with file_too_large', () => {
    const root = tmp();
    writeFileSync(join(root, 'big.md'), Buffer.alloc(MAX_FILE_BYTES + 1, 97));
    expect(codeOf(() => hashRegularFile(root, join(root, 'big.md'), { write: true }))).toBe(
      'file_too_large',
    );
    writeFileSync(join(root, 'ok.md'), Buffer.alloc(MAX_FILE_BYTES, 97));
    expect(hashRegularFile(root, join(root, 'ok.md'), { write: false })).toMatch(/^[0-9a-f]{40}$/);
  });

  it('bounds a file that grows between fstat and read', () => {
    const root = tmp();
    const file = join(root, 'grow.md');
    writeFileSync(file, '0123456789');
    const code = codeOf(() =>
      hashRegularFile(root, file, {
        write: true,
        maxBytes: 16,
        afterFstat: () => appendFileSync(file, Buffer.alloc(100_000, 98)),
      }),
    );
    expect(code).toBe('file_too_large');
  });
});
