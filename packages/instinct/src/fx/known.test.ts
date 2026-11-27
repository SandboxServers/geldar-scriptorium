import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_FILE_MAX, KNOWN_NAMES_MAX, readKnownText } from './known.ts';

/** A workspace with a memory folder; the sentinel sits outside memory and must never be read. */
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'instinct-known-'));
  mkdirSync(join(root, 'memory', 'journal'), { recursive: true });
  mkdirSync(join(root, 'memory', 'people'), { recursive: true });
  writeFileSync(join(root, 'outside.md'), 'SentinelOutside');
  return root;
}

describe('readKnownText', () => {
  it('is empty when the workspace is unset', () => {
    expect(readKnownText(undefined)).toBe('');
    expect(readKnownText('')).toBe('');
  });

  it('reads beliefs, summary and the current journal, lowercased, with the people file names', () => {
    const root = workspace();
    writeFileSync(join(root, 'memory', 'beliefs.md'), 'The Oak Grove is north.');
    writeFileSync(join(root, 'memory', 'summary.md'), 'Summary of Ash.');
    writeFileSync(join(root, 'memory', 'journal', 'current.md'), 'Journal Entry');
    writeFileSync(join(root, 'memory', 'people', 'Bria.md'), 'x');
    const text = readKnownText(root);
    expect(text).toContain('oak grove');
    expect(text).toContain('summary of ash');
    expect(text).toContain('journal entry');
    expect(text).toContain('bria.md');
  });

  it('reads nothing outside memory/ (sentinel file next to memory/ and a goals file in memory/)', () => {
    const root = workspace();
    writeFileSync(join(root, 'memory', 'goals.md'), 'SentinelGoal');
    const text = readKnownText(root);
    expect(text).not.toContain('sentinel');
    expect(text).not.toContain('outside');
  });

  it('skips a missing file, a link and a folder without failing', () => {
    const root = workspace();
    writeFileSync(join(root, 'real.md'), 'hidden');
    mkdirSync(join(root, 'memory', 'beliefs.md'));
    try {
      symlinkSync(join(root, 'real.md'), join(root, 'memory', 'summary.md'));
    } catch {
      // Links need a privilege on some Windows hosts: the folder case above still runs.
    }
    expect(readKnownText(root)).toBe('');
  });

  it('reads at most 32 KiB of one file', () => {
    const root = workspace();
    writeFileSync(join(root, 'memory', 'beliefs.md'), `${'a'.repeat(KNOWN_FILE_MAX)}TAILWORD`);
    const text = readKnownText(root);
    expect(text).not.toContain('tailword');
    expect(text.length).toBe(KNOWN_FILE_MAX);
  });

  it('reads at most 40 people file names', () => {
    const root = workspace();
    for (let i = 0; i < KNOWN_NAMES_MAX + 5; i += 1) {
      writeFileSync(join(root, 'memory', 'people', `person${String(i).padStart(3, '0')}.md`), 'x');
    }
    const text = readKnownText(root);
    expect(text).toContain('person039.md');
    expect(text).not.toContain('person040.md');
  });
});
