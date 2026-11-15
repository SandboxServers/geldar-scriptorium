import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readGoals, readHandoff, readOwnFile } from './handoff.ts';

let root: string;
let journal: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'geldar-handoff-'));
  journal = join(root, 'memory', 'journal');
  mkdirSync(journal, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const note = (bytes: string | Buffer) => writeFileSync(join(journal, 'handoff.md'), bytes);

describe('readHandoff', () => {
  it('reads the note from memory/journal/handoff.md', () => {
    note('I am tired. The door is open.\n');
    expect(readHandoff(root)).toBe('I am tired. The door is open.');
  });

  it('gives empty text when the file is missing', () => {
    expect(readHandoff(root)).toBe('');
    expect(readHandoff(join(root, 'nowhere'))).toBe('');
  });

  it('drops control characters and C1, keeps newline and tab', () => {
    note('a\u0000b\u001bc\u009bd\tx\r\ny  \n\n');
    expect(readHandoff(root)).toBe('abcd\tx\ny');
  });

  it('cuts at 4000 bytes without a half character at the end', () => {
    note(`${'x'.repeat(3999)}é tail`);
    expect(readHandoff(root)).toBe('x'.repeat(3999));
    note('é'.repeat(3000));
    expect(readHandoff(root)).toBe('é'.repeat(2000));
    note('x'.repeat(5000));
    expect(readHandoff(root)).toBe('x'.repeat(4000));
  });

  it('refuses a directory at the note path', () => {
    mkdirSync(join(journal, 'handoff.md'));
    expect(readHandoff(root)).toBe('');
  });

  it('refuses a symlink at the note path', () => {
    writeFileSync(join(root, 'elsewhere.md'), 'not yours\n');
    try {
      symlinkSync(join(root, 'elsewhere.md'), join(journal, 'handoff.md'));
    } catch {
      console.info('symlinks are not available here: the symlink refusal is not tested');
      return;
    }
    expect(readHandoff(root)).toBe('');
  });

  it('refuses a symlinked parent folder', () => {
    const other = join(root, 'other');
    mkdirSync(other);
    writeFileSync(join(other, 'handoff.md'), 'not yours\n');
    rmSync(join(root, 'memory'), { recursive: true, force: true });
    mkdirSync(join(root, 'memory'));
    try {
      symlinkSync(other, join(root, 'memory', 'journal'));
    } catch {
      console.info('symlinks are not available here: the parent refusal is not tested');
      return;
    }
    expect(readHandoff(root)).toBe('');
  });

  it.skipIf(process.platform === 'win32')('refuses a FIFO at the note path', () => {
    execFileSync('mkfifo', [join(journal, 'handoff.md')]);
    expect(readHandoff(root)).toBe('');
  });

  it('reads the file again on each call', () => {
    note('first\n');
    expect(readHandoff(root)).toBe('first');
    note('second\n');
    expect(readHandoff(root)).toBe('second');
  });
});

describe('readGoals', () => {
  const goals = (bytes: string | Buffer) => writeFileSync(join(root, 'memory', 'goals.md'), bytes);

  it('reads the goals from memory/goals.md', () => {
    goals('Keep to the river.\n');
    expect(readGoals(root)).toBe('Keep to the river.');
  });

  it('gives empty text when the file is missing', () => {
    expect(readGoals(root)).toBe('');
  });

  it('cuts at 3000 bytes without a half character at the end', () => {
    goals(`${'x'.repeat(2999)}é tail`);
    expect(readGoals(root)).toBe('x'.repeat(2999));
    goals('é'.repeat(1600));
    expect(readGoals(root)).toBe('é'.repeat(1500));
  });

  it('drops control characters and C1, keeps newline and tab', () => {
    goals('a\u0000b\u001bc\u009bd\tx\r\ny  \n\n');
    expect(readGoals(root)).toBe('abcd\tx\ny');
  });

  it('refuses a directory at the goals path', () => {
    mkdirSync(join(root, 'memory', 'goals.md'));
    expect(readGoals(root)).toBe('');
  });

  it('refuses a symlink at the goals path', () => {
    writeFileSync(join(root, 'elsewhere.md'), 'not yours\n');
    try {
      symlinkSync(join(root, 'elsewhere.md'), join(root, 'memory', 'goals.md'));
    } catch {
      console.info('symlinks are not available here: the symlink refusal is not tested');
      return;
    }
    expect(readGoals(root)).toBe('');
  });

  it('refuses a symlinked parent folder', () => {
    const other = join(root, 'other');
    mkdirSync(other);
    writeFileSync(join(other, 'goals.md'), 'not yours\n');
    rmSync(join(root, 'memory'), { recursive: true, force: true });
    try {
      symlinkSync(other, join(root, 'memory'));
    } catch {
      console.info('symlinks are not available here: the parent refusal is not tested');
      return;
    }
    expect(readGoals(root)).toBe('');
  });

  it('reads the file again on each call', () => {
    goals('first\n');
    expect(readGoals(root)).toBe('first');
    goals('second\n');
    expect(readGoals(root)).toBe('second');
  });

  it('reads any own file with its own cap through readOwnFile', () => {
    mkdirSync(join(root, 'notes'));
    writeFileSync(join(root, 'notes', 'a.md'), 'x'.repeat(50));
    expect(readOwnFile(root, 'notes/a.md', 10)).toBe('x'.repeat(10));
  });
});
