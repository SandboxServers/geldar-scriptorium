import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './check.ts';

// The scan helpers shared by the tool-only skill tests (SC-160a and SC-160b).

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
export const forbiddenMention =
  /\b(reach|recall|register|glass|kino|viewer|budget|meter|models?|prompts?|sessions?|tokens?|sound|interest|moot|author|shrine|smelt\w*|write_book|offer|propose|vote|define_skill|use_skill|sun|gravestones?|despawn\w*)\b/i;

export interface Skill {
  name: string;
  description: string;
  body: string;
  text: string;
}

export function readSkill(name: string): Skill {
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
export function markedWords(text: string): string[] {
  const plain = minecraftPhrases.reduce((rest, phrase) => rest.replace(phrase, ' '), text);
  const words = plain.match(/[A-Za-z][A-Za-z_-]*/g) ?? [];
  return words.filter((word) => markerWord.test(word));
}

// Removes the backtick-quoted spans, which are the quoted world texts and tool names, and the
// numbered list markers, which are structure and not numbers.
export function unquoted(text: string): string {
  return text.replace(/`[^`]*`/g, ' ').replace(/^\d+\. /gm, '');
}
