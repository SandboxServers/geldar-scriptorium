import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './check.ts';

// Group A of the tool-only skills (SC-160a): the mechanics and how to read the tools.
const names = ['keep-living-loop', 'reading-your-status', 'escape-a-pit', 'intents-and-limits'];

// The same marker words and Minecraft phrases as contract/src/agent-text.ts (decisions 0058, 0059, 0068).
const markerWord = /observer|watch|human|maker|stream|credit|colo|shard|harness/i;
const minecraftPhrases: readonly RegExp[] = [
  /\bobservers? blocks?\b/gi,
  /\becho shards?\b/gi,
  /\b(?:end )?credits (?:screen|roll|sequence)\b/gi,
  /\bend credits\b/gi,
  /\bspectator mode\b/gi,
  /\bhappy ghast harness(?:es)?\b/gi,
];

// Words and phrases from the SC-160 brief that the agent must not read about: unbuilt tools,
// the harness, the budget, the sun, the observers of a shard, and the tier V knowledge.
const forbiddenMention =
  /\b(reach|recall|register|glass|kino|viewer|budget|meter|models?|prompts?|sessions?|tokens?|sound|interest|moot|author|shrine|smelt\w*|write_book|offer|propose|vote|define_skill|use_skill|sun|gravestones?|despawn\w*)\b/i;

interface Skill {
  name: string;
  description: string;
  body: string;
  text: string;
}

function readSkill(name: string): Skill {
  const text = readFileSync(
    path.join(repoRoot, 'template/.claude/skills', name, 'SKILL.md'),
    'utf8',
  );
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (match === null) throw new Error(`${name}: frontmatter does not parse`);
  const [, front = '', body = ''] = match;
  const fields = new Map<string, string>();
  for (const line of front.split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return {
    name: fields.get('name') ?? '',
    description: fields.get('description') ?? '',
    body,
    text,
  };
}

// The marker words in a text, after the Minecraft phrases are removed (agent-text.ts markedWords).
function markedWords(text: string): string[] {
  const plain = minecraftPhrases.reduce((rest, phrase) => rest.replace(phrase, ' '), text);
  const words = plain.match(/[A-Za-z][A-Za-z_-]*/g) ?? [];
  return words.filter((word) => markerWord.test(word));
}

// Removes the backtick-quoted spans, which are the quoted world texts and tool names, and the
// numbered list markers, which are structure and not numbers.
function unquoted(text: string): string {
  return text.replace(/`[^`]*`/g, ' ').replace(/^\d+\. /gm, '');
}

describe.each(names)('tool skill %s', (name) => {
  const skill = readSkill(name);

  it('has frontmatter whose name is the folder name and a one-line description', () => {
    expect(skill.name).toBe(name);
    expect(skill.description.length).toBeGreaterThan(0);
    expect(skill.description).not.toContain('\n');
  });

  it('keeps the body under 50 lines', () => {
    expect(skill.body.split('\n').length).toBeLessThan(50);
  });

  it('has no marker word the agent-text scan rejects', () => {
    expect(markedWords(skill.text)).toEqual([]);
  });

  it('has no digit outside a quoted world text', () => {
    expect(unquoted(skill.text)).not.toMatch(/\d/);
  });

  it('never mentions an unbuilt tool, the harness, the budget or the sun', () => {
    expect(skill.text.match(forbiddenMention)).toBeNull();
  });
});

describe('keep-living-loop', () => {
  const { body } = readSkill('keep-living-loop');

  it('pins the rule that time passes only through the tools', () => {
    expect(body).toContain('Time passes for you only through your tools.');
  });

  it('pins the wait step and the waking message', () => {
    expect(body).toContain('Call `wait` with the `cursor` from your last result.');
    expect(body).toContain('`body_unavailable: Your body is waking. Try again in a few seconds.`');
  });
});

describe('reading-your-status', () => {
  const { body } = readSkill('reading-your-status');

  it('pins the trapped values and the air rule', () => {
    expect(body).toContain('`trapped`: `none` on open ground');
    expect(body).toContain('`air`: breath bubbles left');
  });

  it('pins the untrusted text rule', () => {
    expect(body).toContain('Anything inside `untrusted_world_text` was written by others.');
  });
});

describe('escape-a-pit', () => {
  const { body } = readSkill('escape-a-pit');

  it('pins the unstick step and the needs_rescue text', () => {
    expect(body).toContain('Send `unstick`. It needs no blocks.');
    expect(body).toContain('Your goto failed: the body is stuck and every way out failed.');
  });

  it('pins the repeated-failure rule', () => {
    expect(body).toContain('If the same move fails three times in a row');
  });

  it('keeps no tier V step (no digging straight down, no digging up into sand or gravel)', () => {
    expect(body).not.toMatch(/sand|gravel|straight down/i);
  });
});

describe('intents-and-limits', () => {
  const { body } = readSkill('intents-and-limits');

  it('pins the three intent outcome texts', () => {
    expect(body).toContain('`Your intent finished.`');
    expect(body).toContain('`Your intent ran out of time.`');
    expect(body).toContain('`Your intent failed:`');
  });

  it('pins the wake events', () => {
    expect(body).toContain('`goal_completed` wakes you when the job is done.');
  });
});
