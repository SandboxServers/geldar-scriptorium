import { describe, expect, it } from 'vitest';
import { makeFact } from './facts.ts';

describe('facts', () => {
  it('fills the three templates with the world words', () => {
    expect(makeFact('repeat_failure', { n: 3 })).toBe(
      'You have tried this 3 times and it has not worked.',
    );
    expect(makeFact('new_sighting', { name: "Ann's dog" })).toBe(
      "You have not seen Ann's dog before.",
    );
    expect(makeFact('own_act', { line: 'Your intent finished.' })).toBe(
      'You did this a moment ago: Your intent finished.',
    );
  });

  it('refuses a name outside the allowed set and a count that is not a whole number of at least 1', () => {
    expect(makeFact('new_sighting', { name: 'Ann<script>' })).toBeNull();
    expect(makeFact('new_sighting', { name: 'x'.repeat(41) })).toBeNull();
    expect(makeFact('repeat_failure', { n: 0 })).toBeNull();
    expect(makeFact('repeat_failure', { n: 1.5 })).toBeNull();
  });

  it('truncates the world reply to 120 characters and keeps the fact printable and under 200', () => {
    const fact = makeFact('own_act', { line: `"${'z'.repeat(300)}"` });
    expect(fact).not.toBeNull();
    // the world reply is 120 characters after the quote change: one quote and 119 z
    expect(fact).toMatch(/^You did this a moment ago: '[z]{119}$/);
    expect((fact as string).length).toBeLessThanOrEqual(200);
    expect(makeFact('own_act', { line: 'tab\there' })).toBe('You did this a moment ago: tabhere');
  });
});
