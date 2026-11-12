import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './check.ts';

// The skills this packet ships. Later packets add their own names here.
const skillNames = ['play', 'reflect', 'setup'];

interface Skill {
  frontmatter: Record<string, string>;
  body: string;
}

// Splits a SKILL.md into its frontmatter (simple `key: value` lines between
// two `---` fences) and its body. Throws when the fences are missing.
function parseSkill(text: string): Skill {
  const lines = text.split('\n');
  if (lines[0] !== '---') throw new Error('frontmatter must open with ---');
  const close = lines.indexOf('---', 1);
  if (close === -1) throw new Error('frontmatter must close with ---');
  const frontmatter: Record<string, string> = {};
  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(':');
    if (at === -1) throw new Error(`bad frontmatter line: ${line}`);
    frontmatter[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { frontmatter, body: lines.slice(close + 1).join('\n') };
}

function readSkill(name: string): string {
  return readFileSync(path.join(repoRoot, 'template/.claude/skills', name, 'SKILL.md'), 'utf8');
}

describe.each(skillNames)('skill %s', (name) => {
  const skill = parseSkill(readSkill(name));

  it('has frontmatter that parses', () => {
    expect(skill.frontmatter.name).toBeDefined();
    expect(skill.frontmatter.description).toBeDefined();
  });

  it('names the skill after its folder', () => {
    expect(skill.frontmatter.name).toBe(name);
  });

  it('has a description', () => {
    expect((skill.frontmatter.description ?? '').length).toBeGreaterThan(0);
  });

  it('keeps the body under 80 lines', () => {
    expect(skill.body.split('\n').length).toBeLessThan(80);
  });
});

describe('play skill', () => {
  const body = parseSkill(readSkill('play')).body;

  it('uses the wait cursor and the 240 second window', () => {
    expect(body).toContain('cursor');
    expect(body).toContain('240');
  });

  it('tells the character once to use act with unstick when stuck, with no digit or jargon', () => {
    const lines = body.split('\n').filter((l) => l.includes('unstick'));
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? '';
    expect(line).toContain('`act`');
    expect(line).toContain('`unstick`');
    expect(line).not.toMatch(/\d/);
    expect(line).not.toMatch(/reflex|cooldown|geldar|PR\b/i);
  });

  it('teaches every waking a doing of its own, shared and written, before the reading lines', () => {
    for (const line of [
      '## Why you go out',
      'This world is new to you, and you want to understand it.',
      'A day spent only waiting teaches you nothing, so each waking do at least one thing you have not done before.',
      'Go somewhere you have not been.',
      'Look closely at something you cannot name.',
      'Try something in a new way.',
      'Ask someone what they know.',
      'If something blocks you, try a different way or a different direction, not the same attempt again.',
      'Write what you learn in your journal.',
      'What you learn is worth more when it is shared.',
      'Tell the people you meet what you found out, and ask them what they have learned.',
      'Rest is allowed, but it is a pause between doings, not the day.',
    ]) {
      expect(body).toContain(line);
    }
    expect(body.indexOf('## Why you go out')).toBeLessThan(body.indexOf('## Reading your results'));
  });

  it('keeps the why-you-go-out section free of digits, meta words and the names it must not teach', () => {
    const start = body.indexOf('## Why you go out');
    const end = body.indexOf('## Reading your results');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // The quoted world texts (such as the craft reason "within reach") are the world's own words.
    const section = body.slice(start, end).replace(/"[^"]*"/g, '');
    expect(section).not.toMatch(/\d/);
    expect(section).not.toMatch(
      /\b(game|bot|model|AI|prompt|session|token|player|server|tool|MCP|API|error|outcomes?|events?)\b/i,
    );
    expect(section).not.toMatch(/\brecall\b|\breach\b|register|sign-up|sound wake|wake interest/i);
    expect(section).not.toMatch(/glass|viewer|watch|observer|audience/i);
  });

  it('teaches crafting: how to try it, the three reason lines, and the furnace that heat work uses', () => {
    for (const line of [
      '## Crafting',
      'To make something, call `act` with `craft`, the thing you want and how many.',
      'You need the materials in your pack.',
      'Some things need a crafting table close to you.',
      'Heat work is done with `craft` too, with no separate verb: if the thing needs only a heat-using recipe, craft uses a furnace near you, if there is one.',
      'Your readings say whether a furnace near you is lit, and nothing more about what is inside it.',
      '"Your craft failed: you lack the materials."',
      '"Your craft failed: there is no crafting table within reach."',
      '"Your craft failed: it took too long."',
    ]) {
      expect(body).toContain(line);
    }
    expect(body.indexOf('## Crafting')).toBeLessThan(body.indexOf('## Reading your results'));
  });

  it('teaches signs and books: write_sign with the words, read_book when you hold a book, and their exact lines', () => {
    for (const line of [
      '## Signs and books',
      'To write a sign, call `act` with `write_sign` and the words you want on it.',
      'You need a sign in your pack first.',
      '"Your write sign failed: you lack the materials."',
      '"Your write sign worked."',
      'To read a book, you must hold it.',
      'Call `read_book`, and what is written in it comes back to you.',
      '"You hold no book."',
    ]) {
      expect(body).toContain(line);
    }
    expect(body.indexOf('## Signs and books')).toBeLessThan(
      body.indexOf('## Reading your results'),
    );
  });

  it('never teaches the unavailable book writing, and never mentions a moot or a shrine', () => {
    expect(body).not.toMatch(/write_book|write a book|shrine|moot stone/i);
  });

  it('never mentions a recipe, a list of items or a smelting verb in the crafting section', () => {
    const start = body.indexOf('## Crafting');
    const section = body
      .slice(start, body.indexOf('## Reading your results'))
      .replace(/"[^"]*"/g, '');
    expect(section).not.toMatch(/recipe book|smelt|ingredient|\bplanks?\b|\blogs?\b|\bcobble/i);
  });

  it('never gives through a separate give tool', () => {
    expect(body).not.toContain('give(');
  });

  it('teaches giving and following: only to someone you can see, and the exact unseen line', () => {
    for (const line of [
      '## Giving and following',
      'You can give something to someone, or follow someone, only when you can see them now.',
      'Someone behind a wall, or out of sight beyond the trees, is not there for you.',
      'To give, call `act` with `give`, the person you give to, the thing and how many.',
      'To follow, put it in an intent: the program is `follow`, and its target is the person to keep near.',
      'An unknown name and a person you cannot see read the same.',
      '"Your give failed: what you looked for was not found."',
      'Following needs the person in sight in the same way.',
    ]) {
      expect(body).toContain(line);
    }
    expect(body.indexOf('## Giving and following')).toBeLessThan(
      body.indexOf('## Reading your results'),
    );
  });

  it('teaches the world fixed lines for results, hurt, sounds, body and death', () => {
    for (const line of [
      'Your dig failed: the way was blocked.',
      'You could not get there: the way was blocked.',
      'You lack the materials to craft that.',
      'An arrow hit you from behind.',
      'You are burning.',
      'You hear hissing close to the north.',
      'You hear thunder far off to the west.',
      'Health does not regenerate naturally while hunger is low. Hunger falls over time.',
      'You died. Something struck you down. You wake at the spawn with nothing.',
      'You died in the nether. Something struck you down. You wake at the spawn with nothing.',
      'You dropped 3 oak_log, 1 stone_pickaxe near x=190 y=61 z=224.',
      'You dropped N items where you died.',
    ]) {
      expect(body).toContain(line);
    }
    expect(body).toContain('"and N more"');
  });

  it('names the place of a death only in the quoted death line', () => {
    const quoted =
      'You died in the nether. Something struck you down. You wake at the spawn with nothing.';
    expect(body).toContain(quoted);
    expect(body.replace(quoted, '')).not.toMatch(/nether|overworld/i);
  });

  it('says what a death drops and where, in the prose of the death step', () => {
    expect(body).toContain('Weigh the cause first');
    expect(body).toContain('know that they may be gone by the time you return');
    expect(body).toContain('what killed you');
  });

  it('keeps the new reading sections free of meta words and digits', () => {
    const start = body.indexOf('## Reading your results');
    const end = body.indexOf('Budget:');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // The world's quoted fixed lines may carry digits and words such as "events"; the prose may not.
    const section = body.slice(start, end).replace(/"[^"]*"/g, '');
    expect(section).not.toMatch(/\d/);
    expect(section).not.toMatch(
      /\b(outcomes?|events?|reflexes?|lives?|life's|respawns?|games?|counters?|budgets?|kit|tools? call|API|MCP|server)\b/i,
    );
  });

  it('teaches the new result lines exactly, and what each one means', () => {
    for (const line of [
      '"Your <verb> failed: it changed nothing."',
      'Look again and choose something else.',
      '"Your goto failed: the body is stuck and every way out failed."',
      'Look around, then decide your next move from where you actually stand.',
      '"Reflex eat: your hunger was low, so you ate."',
      'The food you have seen is listed in what your senses report, newest first, with its kind and where it is.',
      '"<verb> <target> has failed <N> times in a row (<reason>); position unchanged for <M> minutes."',
      'It means this attempt is not working where you stand, so change your approach and do not repeat it.',
      '"Nothing has changed since you last slept: same place, same belongings, same health, no new events."',
      'There is nothing new to act on yet, so go out and look for what is new.',
      '"Your body is waking. Try again in a few seconds."',
      'Wait a few seconds, then look again.',
    ]) {
      expect(body).toContain(line);
    }
  });

  it('never mentions dimensions, reach, register or a sound wake', () => {
    // Only the quoted world texts may carry the word reach (the craft reason, quoted exactly).
    expect(body.replace(/"[^"]*"/g, '')).not.toMatch(
      /dimension|\breach\b|register|sign-up|sound wake|wake interest/i,
    );
    expect(body).not.toContain('you heard a sound');
  });

  it('keeps the recall and reach tools out of the new reading and waking sections', () => {
    const start = body.indexOf('## Reading your results');
    const section = body.slice(start);
    expect(section).not.toMatch(/recall|reach/i);
  });

  it('teaches looking with view: what it shows, when to use it, and that it is free', () => {
    for (const line of [
      '## Looking with `view`',
      'It tells you what fills the left, ahead and right of you, and what is up, level with you and down.',
      'If walls close in on every side, you are enclosed.',
      'A small grid of marks shows the same thing at a glance: "." is air and "#" is solid.',
      'Use it before you move into the unknown, when something seems wrong, after you wake, and when you are hurt or trapped.',
      'Looking with `view` costs nothing.',
      'What you see is what is in front of you now, not a map.',
      'If `view` fails, wait a moment and view again.',
      '`view` costs nothing, so it is not counted in that.',
    ]) {
      expect(body).toContain(line);
    }
  });

  it('keeps the view section free of tool jargon, digits and the names it must not teach', () => {
    const start = body.indexOf('## Looking with `view`');
    const end = body.indexOf('Budget:');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = body.slice(start, end);
    expect(section.replace(/"[^"]*"/g, '')).not.toMatch(/\d/);
    expect(section).not.toMatch(/\b(game|bot|model|tool|MCP|API|server|error|unavailable)\b/i);
    expect(section).not.toMatch(/`see`|`reach`|`recall`|\bsee\(|\breach\(/);
    expect(section).not.toMatch(/sound wake|wake interest|register|sign-up/i);
  });

  it('teaches looking with see: a picture with a caption, when to use it, and the refusals', () => {
    for (const line of [
      '## Looking with `see`',
      'Call `see` to get a picture of what is in front of your eyes, drawn small, with a short caption under it:',
      '"what you see, from your eyes (an approximation, not a photograph)."',
      'Use it when something strange is in front of you, when a creature is near and you cannot make it out from words, or when you are about to enter a place you do not know.',
      '"A picture is still being drawn. Try again in a moment."',
      'Then wait a while and try again.',
      'Pictures come only now and then.',
      '"Pictures are limited to one every 5 seconds and 30 an hour. Look again shortly."',
    ]) {
      expect(body).toContain(line);
    }
  });

  it('keeps the see section free of digits outside quotes and of the names it must not teach', () => {
    const start = body.indexOf('## Looking with `see`');
    expect(start).toBeGreaterThan(-1);
    const section = body.slice(start);
    expect(section.replace(/"[^"]*"/g, '')).not.toMatch(/\d/);
    expect(section).not.toMatch(/\b(game|bot|model|tool|MCP|API|server|error)\b/i);
    expect(section).not.toMatch(
      /\breach\b|\brecall\b|dimension|register|sign-up|sound wake|wake interest/i,
    );
  });

  it('teaches the world going still and the reflex give-up line', () => {
    for (const line of [
      '"The world will go still for about 30 seconds."',
      '"The world will go still for a while."',
      '"Your senses may flicker for a moment."',
      'Finish what you are doing safely, start nothing risky, and wait.',
      '"The world moves again."',
      'Look around before you act, because the place may have changed while it was still.',
      '"arrow sidestep paused: still under fire (15s)."',
      'Then look and decide for yourself.',
    ]) {
      expect(body).toContain(line);
    }
  });
});

describe('play and trade never promise what is not yet in the world', () => {
  // Moot, author, offer, propose and vote are not available; no skill may say otherwise.
  const unavailable = /\b(offer|propose|vote|moot|author)/i;

  for (const name of ['play', 'trade']) {
    it(`${name} skill does not promise offer, propose, vote, moot or author`, () => {
      const body = parseSkill(readSkill(name)).body;
      expect(body).not.toMatch(unavailable);
    });
  }

  it('trade still says a deal is made by speech and given through act', () => {
    const body = parseSkill(readSkill('trade')).body;
    expect(body).toContain(
      '- When a deal is agreed, give through `act`. Speech alone moves nothing.',
    );
  });
});

describe('setup skill', () => {
  const skill = parseSkill(readSkill('setup'));

  it('is started only by the human', () => {
    expect(skill.frontmatter['disable-model-invocation']).toBe('true');
  });

  it('names all five identity headings', () => {
    for (const heading of ['Name', 'Traits', 'Voice', 'Seed', 'Values']) {
      expect(skill.body).toContain(heading);
    }
  });

  it('never mentions player.json', () => {
    expect(skill.body).not.toContain('player.json');
  });

  it('says the character may be fictional', () => {
    expect(skill.body).toContain('fictional');
  });
});

describe('reflect skill', () => {
  const body = parseSkill(readSkill('reflect')).body;

  it('writes the lesson of a death in the character voice, with no meta words', () => {
    expect(body).toContain(
      'If you died today, write first what killed you, what you dropped and where, and what it taught you.',
    );
    expect(body).toContain('the death line may name where in the world you died');
    expect(body).toContain('the drop line names what you dropped and roughly where');
    expect(body).toContain('things may be gone by the time you return');
    expect(body).not.toMatch(/nether|overworld/i);
    expect(body).not.toMatch(/\b(lives?|respawns?|games?|counters?|outcomes?|events?)\b/i);
    expect(body).not.toMatch(/dimension|\breach\b|register|sign-up|sound wake/i);
  });

  it('asks at the end of the day for the new thing learned, the next curiosity and who to tell', () => {
    expect(body).toContain(
      'Write what new thing you learned today, what you are curious about next, and who you could tell.',
    );
    expect(body).not.toMatch(/\b(games?|bots?|models?|prompts?|sessions?|tokens?|players?)\b/i);
  });
});
