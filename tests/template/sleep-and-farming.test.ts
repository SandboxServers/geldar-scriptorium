import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './check.ts';
import { readSkill } from './tool-skill-scan.ts';

// The sleeping share is stated in one place only (the night skill), so a change is one edit.
const sleepShare = 'about a tenth of the people';

// The text of every file under a folder, depth first.
function treeTexts(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? treeTexts(full) : [readFileSync(full, 'utf8')];
  });
}

describe('sleep and farming facts', () => {
  const { text: night } = readSkill('night-safety');

  it('states the sleeping share exactly once in the whole template tree', () => {
    const count = treeTexts(path.join(repoRoot, 'template')).reduce(
      (total, text) => total + text.split(sleepShare).length - 1,
      0,
    );
    expect(night).toContain(sleepShare);
    expect(count).toBe(1);
  });

  it('pins the monster and sleep result texts', () => {
    expect(night).toContain('there are monsters nearby: none in view');
    expect(night).toContain('Your sleep worked: the night was skipped.');
  });

  it('pins the trampling rule of farmland', () => {
    const { text } = readSkill('farming-and-animals');
    expect(text).toContain(
      'Landing on farmland after a jump or a fall can trample it. Walking does not.',
    );
  });
});
