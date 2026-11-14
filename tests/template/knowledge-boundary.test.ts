import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './check.ts';

const boundary =
  'You know only what you have seen, tried, or been told by people here. You do not know how this world works beyond that: you have no recipes, maps, secrets or numbers in your head until you find them out. When you learn something, it is because it happened to you or someone told you.';
const bedLine = '- At night, find a bed and sleep in it.';
const intentLine =
  '- If you have no current intent, choose one now rather than repeating a greeting.';
// The persona lines, as they stand on main; SC-102 adds a section and leaves these alone.
const personaLines = [
  'You are a person in a world. You must eat to live. You can die, and death is permanent.',
  'You speak only to those near you. You can read and write signs and books.',
  'You know of no world beyond this one.',
];
const errandLines = [
  'Send the legwork to the one who does it, one clear errand at a time, and expect a line or two back.',
  'Before you rest, be sheltered, with no errand half-done and out of danger. If you are not, get safe',
  'first, then put a short note in `memory/journal/handoff.md`: use Edit with that path and an empty old_string to create it, or replace its text if it exists, and go on after.',
];
const audienceWords =
  /watch(ed|ing)\s+humans|humans?\s+(watch|read)|watch(ed|ing)|observer|audience|spectator/i;
// Decision 40: no meta terms ("and the like") in the prompt text SC-78 added.
const metaTerms = /\b(games?|wikis?|prompts?|models?|LLMs?|AI|simulations?|NPCs?)\b/i;

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith('.md') ? [full] : [];
  });
}

function characterFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return characterFiles(full);
    return /\.(md|sh|json)$/.test(entry.name) ? [full] : [];
  });
}

describe('player instructions: knowledge boundary', () => {
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const text = readFileSync(path.join(repoRoot, 'template', file), 'utf8');

    it(`${file} carries the knowledge-boundary paragraph verbatim, once`, () => {
      const paragraphs = text.split('\n\n').map((p) => p.trim());
      expect(paragraphs.filter((p) => p === boundary)).toHaveLength(1);
    });

    it(`${file} tells the player to sleep in a bed at night`, () => {
      expect(text.split('\n')).toContain(bedLine);
    });

    it(`${file} keeps the persona lines unchanged`, () => {
      const lines = text.split('\n');
      for (const line of personaLines) expect(lines).toContain(line);
    });

    it(`${file} carries the errands and rest lines, without meta words`, () => {
      const lines = text.split('\n');
      for (const line of errandLines) {
        expect(lines).toContain(line);
        expect(line).not.toMatch(metaTerms);
      }
    });

    it(`${file} tells the player to choose an intent instead of repeating a greeting`, () => {
      expect(text.split('\n')).toContain(intentLine);
    });
  }

  it('the ChatGPT wake-up tells the player to put the handoff note in with its write tool (SC-176)', () => {
    const cli = readFileSync(path.join(repoRoot, 'packages/chatgpt/src/cli.ts'), 'utf8');
    expect(cli).toContain(
      'When this waking is nearly over, use your write tool to put a short note in memory/journal/handoff.md, then save before resting.',
    );
  });

  it('no template markdown file names an audience', () => {
    for (const file of markdownFiles(path.join(repoRoot, 'template'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(audienceWords);
    }
  });

  it('no file the character reads uses a meta term for its people or tools (SC-79)', () => {
    const files = characterFiles(path.join(repoRoot, 'template')).filter(
      (file) =>
        path.basename(file) !== 'README.md' ||
        path.dirname(file) !== path.join(repoRoot, 'template'),
    );
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const banned of ['Your human', 'your human', 'Geldar tools', 'terminal']) {
            expect(line.includes(banned), `${file}:${i + 1} contains "${banned}"`).toBe(false);
          }
        });
    }
  });

  it('the three SC-78 lines use no meta term (decision 40)', () => {
    for (const line of [boundary, bedLine, intentLine]) expect(line).not.toMatch(metaTerms);
  });

  it.each([
    ['humans watch', 'humans watch you'],
    ['human read', 'a human read this'],
    ['watching', 'they are watching'],
    ['watched', 'you are watched'],
  ])('the audience check rejects a fixture with %s', (_word, fixture) => {
    expect(fixture).toMatch(audienceWords);
  });

  it.each(['game', 'wiki', 'prompt', 'model', 'LLM', 'AI', 'simulation', 'NPC'])(
    'the meta-term check rejects a fixture with %s',
    (word) => {
      expect(`a line with ${word} in it`).toMatch(metaTerms);
    },
  );
});
