import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECTION_FORMS } from './sections.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

// Joins the wrapped lines, then reads the backticked tokens of the sections sentence.
function sectionsIn(file: string): string[] {
  const text = readFileSync(file, 'utf8').split(/\r?\n/).join(' ');
  const match = /Its sections are ([^.]*)\./.exec(text);
  if (match === null) throw new Error(`no sections sentence in ${file}`);
  return [...(match[1] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
}

describe('section list drift', () => {
  it.each(['template-src/instructions.md', 'template/CLAUDE.md', 'template/AGENTS.md'])(
    '%s names the same sections as SECTION_FORMS',
    (rel) => {
      expect(sectionsIn(path.join(repo, rel))).toEqual([...SECTION_FORMS]);
    },
  );

  it('ships a template memory file for each fixed section and the people folder', () => {
    for (const f of ['identity', 'summary', 'goals', 'beliefs', 'journal/current']) {
      expect(existsSync(path.join(repo, 'template', 'memory', `${f}.md`))).toBe(true);
    }
    expect(existsSync(path.join(repo, 'template', 'memory', 'people', '.gitkeep'))).toBe(true);
  });
});
