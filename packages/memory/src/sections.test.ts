import { describe, expect, it } from 'vitest';
import { resolveSection } from './sections.ts';

const valid: [string, string][] = [
  ['identity', 'memory/identity.md'],
  ['summary', 'memory/summary.md'],
  ['goals', 'memory/goals.md'],
  ['beliefs', 'memory/beliefs.md'],
  ['journal/current', 'memory/journal/current.md'],
  ['people/pike', 'memory/people/pike.md'],
  ['people/Wren-2', 'memory/people/Wren-2.md'],
  ['journal/day-001', 'memory/journal/day-001.md'],
  ['journal/day-0123', 'memory/journal/day-0123.md'],
  ['journal/day-12345', 'memory/journal/day-12345.md'],
];

const invalid = [
  '',
  'identity.md',
  'IDENTITY',
  'Summary',
  '../CLAUDE',
  'people/../../CLAUDE',
  'people/',
  'people/pike.md',
  'people/pike/x',
  'people/con',
  'people/-x',
  `people/${'a'.repeat(40)}`,
  'journal/day-1',
  'journal/day-1234567',
  'journal/day-001.md',
  'journal/current/',
  'memory/summary',
  '/identity',
  'identity\n',
  'identity\u0000',
  'people/a b',
  'skills/farm',
  'journal',
];

describe('resolveSection', () => {
  it.each(valid)('maps %s to its memory file', (section, file) => {
    expect(resolveSection(section)).toBe(file);
  });

  it.each(invalid)('refuses %j', (section) => {
    expect(resolveSection(section)).toBeNull();
  });
});
