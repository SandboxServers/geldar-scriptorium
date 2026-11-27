import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOAL_FILE_MAX, readAdoptedGoal } from './goal.ts';

/** A workspace whose memory/goals.md holds the given text (or nothing when text is undefined). */
function workspaceWith(text: string | undefined): string {
  const root = mkdtempSync(join(tmpdir(), 'instinct-goal-'));
  if (text !== undefined) {
    mkdirSync(join(root, 'memory'));
    writeFileSync(join(root, 'memory', 'goals.md'), text);
  }
  return root;
}

describe('readAdoptedGoal', () => {
  it('an unset workspace or a missing file gives no goal', () => {
    expect(readAdoptedGoal(undefined)).toBeNull();
    expect(readAdoptedGoal('')).toBeNull();
    expect(readAdoptedGoal(workspaceWith(undefined))).toBeNull();
  });

  it('the first ranked line is the goal; headings and prose are ignored', () => {
    const root = workspaceWith(
      '# Goals\n\nSome prose here.\n1. Build the shelter\n2) Later\n- Another\n',
    );
    expect(readAdoptedGoal(root)).toBe('Build the shelter');
  });

  it('bullets of both kinds count; a CRLF file reads the same', () => {
    expect(readAdoptedGoal(workspaceWith('* star goal\n'))).toBe('star goal');
    expect(readAdoptedGoal(workspaceWith('# H\r\n- crlf goal\r\n'))).toBe('crlf goal');
  });

  it('trims the text', () => {
    expect(readAdoptedGoal(workspaceWith('-    spaced goal   \n'))).toBe('spaced goal');
  });

  it('cuts the text to 200 characters', () => {
    const goal = readAdoptedGoal(workspaceWith(`- ${'x'.repeat(300)}\n`));
    expect(goal).toHaveLength(200);
  });

  it('strips control characters', () => {
    expect(readAdoptedGoal(workspaceWith('- a\u0007b\u001bc\n'))).toBe('abc');
  });

  it('a file over 16 KiB (here 1 MB) gives no goal', () => {
    const root = workspaceWith(`- goal\n${'a'.repeat(1_000_000)}\n`);
    expect(GOAL_FILE_MAX).toBe(16 * 1024);
    expect(readAdoptedGoal(root)).toBeNull();
  });

  it('a file with no ranked line gives no goal', () => {
    expect(readAdoptedGoal(workspaceWith('just prose\n# heading\n'))).toBeNull();
  });
});
