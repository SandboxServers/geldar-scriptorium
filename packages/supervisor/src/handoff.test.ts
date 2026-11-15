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

  it('keeps the last 4000 bytes without a half character at the end', () => {
    // The window is the file's end, so the first x's are dropped: 3993 x's, then é and the tail.
    note(`${'x'.repeat(3999)}é tail`);
    expect(readHandoff(root)).toBe(`${'x'.repeat(3993)}é tail`);
    // A file that ends in a cut character: the cut bytes go, the 3999 x's stay.
    note(Buffer.concat([Buffer.from('x'.repeat(4000)), Buffer.from([0xc3])]));
    expect(readHandoff(root)).toBe('x'.repeat(3999));
    note('é'.repeat(3000));
    expect(readHandoff(root)).toBe('é'.repeat(2000));
    note('x'.repeat(5000));
    expect(readHandoff(root)).toBe('x'.repeat(4000));
  });

  it('reads the newest 4000 bytes of a long journal, starting at a whole line', () => {
    const lines = Array.from(
      { length: 1400 },
      (_, i) => `${String(i + 1).padStart(5, '0')} the note\n`,
    );
    note(lines.join(''));
    const text = readHandoff(root);
    expect(text.split('\n')[0]).toMatch(/^\d{5} the note$/);
    expect(text.endsWith('01400 the note')).toBe(true);
    expect(text).not.toContain('00001 the note');
    expect(text.length).toBeLessThanOrEqual(4000);
  });

  it('returns a file just under the cap whole and unchanged', () => {
    const body = `first line\n${'y'.repeat(3900)}\nlast line\n`;
    note(body);
    expect(readHandoff(root)).toBe(body.trimEnd());
  });

  it('gives valid text when the window has no newline and is all é', () => {
    note(`${'é'.repeat(3000)}END`);
    expect(readHandoff(root)).toBe(`${'é'.repeat(1998)}END`);
  });

  it('drops a multibyte character that straddles the window start whole', () => {
    // The window starts on the second byte of the é: that byte goes, the b's stay.
    note(`a${'é'}${'b'.repeat(3999)}`);
    expect(readHandoff(root)).toBe('b'.repeat(3999));
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

  it('keeps the last 3000 bytes without a half character at the end', () => {
    goals(`${'x'.repeat(2999)}é tail`);
    expect(readGoals(root)).toBe(`${'x'.repeat(2993)}é tail`);
    goals('é'.repeat(1600));
    expect(readGoals(root)).toBe('é'.repeat(1500));
  });

  it('gives the end of a 4 KB goals file, starting at a whole line', () => {
    const lines = Array.from(
      { length: 200 },
      (_, i) => `goal ${String(i + 1).padStart(3, '0')} keep going\n`,
    );
    goals(lines.join(''));
    const text = readGoals(root);
    expect(text.split('\n')[0]).toMatch(/^goal \d{3} keep going$/);
    expect(text.endsWith('goal 200 keep going')).toBe(true);
    expect(text).not.toContain('goal 001 keep going');
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
