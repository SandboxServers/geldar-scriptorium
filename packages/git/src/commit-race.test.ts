import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitMemory } from './commit.ts';
import { git, makeRepo } from './repo-fixture.ts';

const win = process.platform === 'win32';
const CANARY = 'CANARY-SECRET-7f3a91c2';
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function setup(): { root: string; outside: string } {
  const made = makeRepo({ 'CLAUDE.md': 'rules\n', 'memory/identity.md': 'name\n' });
  const outside = mkdtempSync(join(tmpdir(), 'geldar-race-out-'));
  cleanups.push(made.cleanup, () => rmSync(outside, { recursive: true, force: true }));
  return { root: made.root, outside };
}

function blobsHoldCanary(root: string): boolean {
  return git(root, ['cat-file', '--batch-all-objects', '--batch']).includes(CANARY);
}

describe('commitMemory against a swap after classification', () => {
  it.skipIf(win)('a file swapped for a symlink is not saved and its target is in no blob', () => {
    const { root, outside } = setup();
    const secret = join(outside, 'secret');
    writeFileSync(secret, `${CANARY}\n`);
    mkdirSync(join(root, 'memory/journal'), { recursive: true });
    writeFileSync(join(root, 'memory/journal/day-001.md'), 'day one\n');
    writeFileSync(join(root, 'memory/summary.md'), 'ok\n');
    const result = commitMemory(
      { root, message: 'save', mode: 'play' },
      {
        afterClassify: (rel) => {
          if (rel !== 'memory/journal/day-001.md') return;
          unlinkSync(join(root, rel));
          symlinkSync(secret, join(root, rel));
        },
      },
    );
    expect(result.notSaved).toContain('memory/journal/day-001.md');
    expect(result.files).toEqual(['memory/summary.md']);
    expect(blobsHoldCanary(root)).toBe(false);
  });

  it.skipIf(win)('a parent directory swapped for a symlink is refused', () => {
    const { root, outside } = setup();
    mkdirSync(join(root, 'memory/journal'), { recursive: true });
    writeFileSync(join(root, 'memory/journal/day-001.md'), 'day one\n');
    writeFileSync(join(root, 'memory/summary.md'), 'ok\n');
    const other = join(outside, 'journal');
    mkdirSync(other);
    writeFileSync(join(other, 'day-001.md'), `${CANARY}\n`);
    const result = commitMemory(
      { root, message: 'save', mode: 'play' },
      {
        afterClassify: (rel) => {
          if (rel !== 'memory/journal/day-001.md') return;
          renameSync(join(root, 'memory/journal'), join(outside, 'moved'));
          symlinkSync(other, join(root, 'memory/journal'));
        },
      },
    );
    expect(result.notSaved).toContain('memory/journal/day-001.md');
    expect(blobsHoldCanary(root)).toBe(false);
  });

  it('server.ts and cli.ts never reference the test hooks', () => {
    for (const file of ['server.ts', 'cli.ts']) {
      const text = readFileSync(join(import.meta.dirname, file), 'utf8');
      expect(text).not.toMatch(/testHooks|afterClassify/);
    }
  });
});
