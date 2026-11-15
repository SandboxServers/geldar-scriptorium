import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { playInstructions } from './instructions.ts';

const roots: string[] = [];

function workspace(withSkill: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'mind-loop-'));
  roots.push(root);
  writeFileSync(join(root, 'AGENTS.md'), 'AGENTS TEXT');
  if (withSkill) {
    mkdirSync(join(root, '.claude', 'skills', 'play'), { recursive: true });
    writeFileSync(join(root, '.claude', 'skills', 'play', 'SKILL.md'), 'SKILL TEXT');
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('playInstructions', () => {
  it('starts with AGENTS.md, then the play skill, then the memory rules', () => {
    const text = playInstructions(workspace(true));
    expect(text.startsWith('AGENTS TEXT\n')).toBe(true);
    expect(text).toContain('SKILL TEXT');
    expect(text.indexOf('SKILL TEXT')).toBeGreaterThan(text.indexOf('AGENTS TEXT'));
    expect(text).toContain('First use recall_handoff to recall the note you left before resting.');
  });

  it('throws when the play skill is missing', () => {
    expect(() => playInstructions(workspace(false))).toThrow();
  });
});
