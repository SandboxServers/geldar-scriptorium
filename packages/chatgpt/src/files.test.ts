import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileTools, readBounded, writeNote } from './files.ts';

const roots: string[] = [];
const root = (): string => {
  const r = mkdtempSync(join(tmpdir(), 'geldar-chatgpt-files-'));
  roots.push(r);
  return r;
};
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('the ChatGPT character file boundary', () => {
  it('writes/appends notes and learned skills, while refusing identity, kit and credentials paths', () => {
    const r = root();
    writeNote(r, 'memory/journal/current.md', 'Today\n', false);
    writeNote(r, 'memory/journal/current.md', 'I ate.\n', true);
    expect(readFileSync(join(r, 'memory/journal/current.md'), 'utf8')).toBe('Today\nI ate.\n');
    writeNote(r, 'skills/food.md', 'What I learned.', false);
    for (const path of [
      'memory/identity.md',
      'memory/Identity.md',
      '../credentials.json',
      '/cli-home/chatgpt/credentials.json',
      'memory/../skills/foo.md',
      'AGENTS.md',
      '.mcp.json',
      '.claude/skills/play/SKILL.md',
      'memory/foo/../../secret.md',
    ]) {
      expect(() => writeNote(r, path, 'hostile', false), path).toThrow();
    }
    expect(() => writeNote(r, 'memory/summary.md', 'x'.repeat(65537), false)).toThrow();
  });

  it('opens only named skills and never the birth skill, credentials or arbitrary host files', async () => {
    const r = root();
    mkdirSync(join(r, '.claude/skills/play'), { recursive: true });
    writeFileSync(join(r, '.claude/skills/play/SKILL.md'), 'Wait, consider, act.');
    const skill = fileTools(r)[0];
    expect(await skill?.call({ name: 'play' })).toEqual([
      { type: 'input_text', text: 'Wait, consider, act.' },
    ]);
    for (const name of [
      'setup',
      '../../cli-home/chatgpt/credentials.json',
      '/etc/passwd',
      'memory/summary.md',
      '.claude/../secret',
    ]) {
      await expect(skill?.call({ name })).rejects.toThrow();
    }
  });

  it('refuses hardlinked notes without changing their target', () => {
    const r = root();
    const other = root();
    mkdirSync(join(r, 'memory'));
    writeFileSync(join(other, 'secret.md'), 'credential sentinel');
    linkSync(join(other, 'secret.md'), join(r, 'memory/summary.md'));
    expect(() => writeNote(r, 'memory/summary.md', 'changed', false)).toThrow();
    expect(() => readBounded(r, 'memory/summary.md')).toThrow();
    expect(readFileSync(join(other, 'secret.md'), 'utf8')).toBe('credential sentinel');
  });

  it('refuses a symlinked parent even when it points to a readable secret', () => {
    const r = root();
    const other = root();
    writeFileSync(join(other, 'summary.md'), 'credential sentinel');
    symlinkSync(other, join(r, 'memory'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => writeNote(r, 'memory/summary.md', 'changed', false)).toThrow();
    expect(() => readBounded(r, 'memory/summary.md')).toThrow();
    expect(readFileSync(join(other, 'summary.md'), 'utf8')).toBe('credential sentinel');
  });
});
