import { describe, expect, it } from 'vitest';
import { forbiddenMention, markedWords, readSkill, unquoted } from './tool-skill-scan.ts';

// Group C of the tool-only skills (SC-160c): inventory and chests, sharing, death and finding your way.
const names = ['inventory-and-chests', 'sharing-with-others', 'after-a-death', 'finding-your-way'];

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

describe('inventory-and-chests', () => {
  const { body } = readSkill('inventory-and-chests');

  it('pins the deposit and withdraw arguments', () => {
    expect(body).toContain('Give it the `item` name and a `count`.');
    expect(body).toContain('`withdraw` moves one kind of item out of that chest');
  });

  it('pins the open and deposit success texts', () => {
    expect(body).toContain('`Your open worked.`');
    expect(body).toContain('`Your deposit worked.` or `Your withdraw worked.`');
  });

  it('pins the held item and inventory fields', () => {
    expect(body).toContain('`held_item` is what is in your hand.');
    expect(body).toContain('`inventory` lists what you carry, item by item.');
  });
});

describe('sharing-with-others', () => {
  const { body } = readSkill('sharing-with-others');

  it('pins the unseen-name give failure and its single text', () => {
    expect(body).toContain('`Your give failed: what you looked for was not found.`');
    expect(body).toContain('The same line comes back for a person who is hidden');
  });

  it('pins the write_sign lack-of-materials text', () => {
    expect(body).toContain('`missing_materials`: "no sign in the inventory."');
  });

  it('pins the no-trade-window rule', () => {
    expect(body).toContain('There is no trade window.');
  });
});

describe('after-a-death', () => {
  const { body, text } = readSkill('after-a-death');

  it('pins the death line opening', () => {
    expect(body).toContain('`You died.`');
  });

  it('pins the dropped-items line with and N more', () => {
    expect(body).toContain('`You dropped N items where you died.`');
    expect(body).toContain('`and N more`');
  });

  it('pins the life counter and the days reset', () => {
    expect(body).toContain('`life` in `status` counts your lives.');
    expect(body).toContain('`days_alive_this_life` starts again at zero after a death.');
  });

  it('never mentions a gravestone, a grave, a marker or a despawn', () => {
    expect(text).not.toMatch(/gravestone|grave|marker|despawn/i);
  });
});

describe('finding-your-way', () => {
  const { body } = readSkill('finding-your-way');

  it('pins the compass rule', () => {
    expect(body).toContain(
      'North is lower z, south is higher z, east is higher x, west is lower x.',
    );
  });

  it('pins the position fields', () => {
    expect(body).toContain('`position` is x, y and z');
  });

  it('pins the blocked and stuck goto texts', () => {
    expect(body).toContain('`Your goto failed: the way was blocked.`');
    expect(body).toContain('`Your goto failed: the body is stuck and every way out failed.`');
  });
});
