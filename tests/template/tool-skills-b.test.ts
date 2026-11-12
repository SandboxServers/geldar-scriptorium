import { describe, expect, it } from 'vitest';
import { forbiddenMention, markedWords, readSkill, unquoted } from './tool-skill-scan.ts';

// Group B of the tool-only skills (SC-160b): food, the night, fighting or fleeing, and water.
const names = ['eating-and-hunger', 'night-safety', 'fighting-or-fleeing', 'water-and-drowning'];

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

describe('eating-and-hunger', () => {
  const { body } = readSkill('eating-and-hunger');

  it('pins the eat reflex and its unfinished suffix', () => {
    expect(body).toContain('Your body eats by itself when hunger is low and you carry food.');
    expect(body).toContain('`Reflex eat: your hunger was low, so you ate.`');
    expect(body).toContain('`It did not finish.`');
  });

  it('pins the eat failure texts', () => {
    expect(body).toContain('`Your eat failed: you lack the materials.`');
    expect(body).toContain('`Your eat failed: that was not possible right now.`');
  });

  it('pins the food_known empty-list rule', () => {
    expect(body).toContain('An empty list means no food is known.');
  });
});

describe('night-safety', () => {
  const { body } = readSkill('night-safety');

  it('pins the enclosed rule', () => {
    expect(body).toContain(
      '`enclosed` in your view is `true` when solid blocks close your feet in on every side, above and below.',
    );
  });

  it('pins the sleep refusal and the nothing-changed texts', () => {
    expect(body).toContain('`sleep_refused: Your body would not sleep.`');
    expect(body).toContain('`Nothing has changed since you last slept:');
  });

  it('pins the dig-in reflex text', () => {
    expect(body).toContain('`a threat was close, you dug in`');
  });
});

describe('fighting-or-fleeing', () => {
  const { body } = readSkill('fighting-or-fleeing');

  it('pins the fight rule and its reflex line', () => {
    expect(body).toContain(
      'your body fights back. Otherwise it runs. Its line says `a hostile was close, you fought or fled`.',
    );
  });

  it('pins the arrow sidestep rule', () => {
    expect(body).toContain('An arrow flying at you makes your body step aside');
  });

  it('keeps only the body block (no attack, flee or hurt-side instructions)', () => {
    expect(body).not.toMatch(/`attack`|`flee`|`build`|Hurt lines|What you can choose/);
  });
});

describe('water-and-drowning', () => {
  const { body } = readSkill('water-and-drowning');

  it('pins the breath and flag rules', () => {
    expect(body).toContain('`status_flags` shows `underwater` when your head is under the water');
    expect(body).toContain('When none are left, you start to drown.');
  });

  it('pins the deep water and drowning lines', () => {
    expect(body).toContain('`hazards` lists `deep_water` when deep water is in sight.');
    expect(body).toContain('`You are drowning`');
  });
});
