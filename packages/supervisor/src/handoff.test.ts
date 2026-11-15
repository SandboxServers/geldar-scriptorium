import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readGoals, readHandoff, readIdentity, readOwnFile, readPromptBlocks } from './handoff.ts';

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

  it('keeps a long paragraph and a final newline: the last bytes, not nothing', () => {
    note(`${'x'.repeat(5000)}\n`);
    expect(readHandoff(root)).toBe('x'.repeat(3999));
    // The window starts on a continuation byte and ends on the newline: the cut é goes, the rest stays.
    note(`${'é'.repeat(3000)}\n`);
    expect(readHandoff(root)).toBe('é'.repeat(1999));
  });

  it('drops the whole first line when the window starts exactly on a line boundary', () => {
    // 10-byte lines, 1000 of them: the window starts at byte 6000, the first byte of line 601.
    // That line is cut whole, so the text starts at line 602.
    const lines = Array.from(
      { length: 1000 },
      (_, i) => `line ${String(i + 1).padStart(4, '0')}\n`,
    );
    note(lines.join(''));
    const expected = Array.from(
      { length: 399 },
      (_, k) => `line ${String(k + 602).padStart(4, '0')}`,
    );
    expect(readHandoff(root)).toBe(expected.join('\n'));
  });

  it('starts at the next line when the window starts on a newline', () => {
    // The file is 4050 bytes and byte 50 is the newline: the window is that newline and 3999 y's.
    note(`${'x'.repeat(50)}\n${'y'.repeat(3999)}`);
    expect(readHandoff(root)).toBe('y'.repeat(3999));
  });

  it('keeps exactly maxBytes whole, and drops from the first line at maxBytes plus one', () => {
    note(`a\n${'b'.repeat(3998)}`);
    expect(readHandoff(root)).toBe(`a\n${'b'.repeat(3998)}`);
    note(`aa\n${'b'.repeat(3998)}`);
    expect(readHandoff(root)).toBe('b'.repeat(3998));
  });

  it('gives the end of a CRLF file longer than the cap, with no stray carriage return', () => {
    // 11-byte CRLF lines: the window starts 4 bytes into a line, so the cut is mid-line.
    const lines = Array.from(
      { length: 500 },
      (_, i) => `line ${String(i + 1).padStart(4, '0')}\r\n`,
    );
    note(lines.join(''));
    const text = readHandoff(root);
    expect(text).not.toContain('\r');
    expect(text.split('\n')[0]).toMatch(/^line \d{4}$/);
    expect(text.endsWith('line 0500')).toBe(true);
  });

  it('gives empty text for an empty file', () => {
    note('');
    expect(readHandoff(root)).toBe('');
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

  it('keeps the first 4096 bytes without a half character at the end', () => {
    goals(`${'x'.repeat(4095)}é tail`);
    expect(readGoals(root)).toBe('x'.repeat(4095));
    goals('é'.repeat(2600));
    expect(readGoals(root)).toBe('é'.repeat(2048));
  });

  it('gives a 3.5 KB ranked goals file whole, its first line included', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `${i + 1}. ${'k'.repeat(34)}\n`);
    const body = lines.join('');
    expect(Buffer.byteLength(body)).toBeGreaterThan(3500);
    goals(body);
    expect(readGoals(root)).toBe(body.trimEnd());
    expect(readGoals(root).split('\n')[0]).toBe(`1. ${'k'.repeat(34)}`);
  });

  it('keeps the first line of a 5000-byte goals file and cuts it at the end', () => {
    // 50-byte lines: the first 4096 bytes end in the middle of line 82.
    const lines = Array.from(
      { length: 99 },
      (_, i) => `${String(i + 1).padStart(2, '0')}. ${'k'.repeat(45)}\n`,
    );
    const body = `${lines.join('')}100. ${'k'.repeat(44)}\n`;
    expect(Buffer.byteLength(body)).toBe(5000);
    goals(body);
    const text = readGoals(root);
    expect(text.split('\n')[0]).toBe(`01. ${'k'.repeat(45)}`);
    expect(text).toContain(`81. ${'k'.repeat(45)}\n82. `);
    expect(text).not.toContain('83.');
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4096);
  });

  it('gives goals of exactly 4096 bytes whole and cuts goals of 4097 bytes by one byte', () => {
    goals('g'.repeat(4096));
    expect(readGoals(root)).toBe('g'.repeat(4096));
    goals(`${'g'.repeat(4096)}!`);
    expect(readGoals(root)).toBe('g'.repeat(4096));
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

describe('readPromptBlocks', () => {
  const memory = (name: string, bytes: string) => writeFileSync(join(root, 'memory', name), bytes);

  it('gives empty text and no cut for missing files', () => {
    expect(readPromptBlocks(root)).toEqual({
      goals: { text: '', cut: false },
      handoff: { text: '', cut: false },
      identity: { text: '', cut: false },
    });
  });

  it('flags a goals file longer than its cap, and keeps its first line', () => {
    memory('goals.md', `first goal\n${'g'.repeat(5000)}`);
    const goals = readPromptBlocks(root).goals;
    expect(goals.cut).toBe(true);
    expect(goals.text.startsWith('first goal\n')).toBe(true);
  });

  it('does not flag goals of exactly the cap', () => {
    memory('goals.md', 'g'.repeat(4096));
    expect(readPromptBlocks(root).goals).toEqual({ text: 'g'.repeat(4096), cut: false });
  });

  it('keeps the end of a 5000-byte handoff and flags it', () => {
    note(`${'h'.repeat(1000)}${'z'.repeat(4000)}`);
    expect(readPromptBlocks(root).handoff).toEqual({ text: 'z'.repeat(4000), cut: true });
  });

  it('flags an identity longer than its cap', () => {
    memory('identity.md', 'i'.repeat(9000));
    expect(readPromptBlocks(root).identity.cut).toBe(true);
    expect(readPromptBlocks(root).goals.cut).toBe(false);
    expect(readPromptBlocks(root).handoff.cut).toBe(false);
  });
});

describe('readIdentity', () => {
  const identity = (bytes: string | Buffer) =>
    writeFileSync(join(root, 'memory', 'identity.md'), bytes);

  it('reads the identity from memory/identity.md', () => {
    identity('I am a ferryman.\n');
    expect(readIdentity(root)).toBe('I am a ferryman.');
  });

  it('gives empty text when the file is missing', () => {
    expect(readIdentity(root)).toBe('');
  });

  it('returns a file of 3000 bytes whole', () => {
    const body = `${'x'.repeat(2985)}\nlast line here`;
    expect(Buffer.byteLength(body)).toBe(3000);
    identity(body);
    expect(readIdentity(root)).toBe(body);
  });

  it('keeps the start of a file longer than 8192 bytes and cuts its end', () => {
    identity('a'.repeat(9000));
    expect(readIdentity(root)).toBe('a'.repeat(8192));
  });

  it('cuts a longer file at 8192 bytes without a half character', () => {
    identity(`${'x'.repeat(8191)}é${'y'.repeat(900)}`);
    expect(readIdentity(root)).toBe('x'.repeat(8191));
    identity('é'.repeat(5000));
    expect(readIdentity(root)).toBe('é'.repeat(4096));
  });

  it('drops control characters and C1, keeps newline and tab', () => {
    identity('a\u0000b\u001bc\u009bd\tx\r\ny  \n\n');
    expect(readIdentity(root)).toBe('abcd\tx\ny');
  });

  it('refuses a directory at the identity path', () => {
    mkdirSync(join(root, 'memory', 'identity.md'));
    expect(readIdentity(root)).toBe('');
  });

  it('refuses a symlink at the identity path', () => {
    writeFileSync(join(root, 'elsewhere.md'), 'not yours\n');
    try {
      symlinkSync(join(root, 'elsewhere.md'), join(root, 'memory', 'identity.md'));
    } catch {
      console.info('symlinks are not available here: the symlink refusal is not tested');
      return;
    }
    expect(readIdentity(root)).toBe('');
  });

  it('refuses a symlinked parent folder', () => {
    const other = join(root, 'other');
    mkdirSync(other);
    writeFileSync(join(other, 'identity.md'), 'not yours\n');
    rmSync(join(root, 'memory'), { recursive: true, force: true });
    try {
      symlinkSync(other, join(root, 'memory'));
    } catch {
      console.info('symlinks are not available here: the parent refusal is not tested');
      return;
    }
    expect(readIdentity(root)).toBe('');
  });

  it('reads the file again on each call', () => {
    identity('first\n');
    expect(readIdentity(root)).toBe('first');
    identity('second\n');
    expect(readIdentity(root)).toBe('second');
  });
});
