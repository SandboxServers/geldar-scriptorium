import { isAllowedPath } from '@geldar/scriptorium-path-rule';

// The sections as the instructions name them, in their order.
export const SECTION_FORMS = [
  'identity',
  'summary',
  'goals',
  'beliefs',
  'people/<name>',
  'journal/current',
  'journal/day-NNN',
] as const;

const FIXED = new Set(['identity', 'summary', 'goals', 'beliefs', 'journal/current']);
const PERSON_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;
const DAY_DIGITS = /^\d{3,5}$/;

// Returns the file under the root ('memory/summary.md'), or null when the section is not valid.
export function resolveSection(section: string): string | null {
  let file: string | null = null;
  if (FIXED.has(section)) {
    file = `memory/${section}.md`;
  } else if (section.startsWith('people/') && PERSON_NAME.test(section.slice('people/'.length))) {
    file = `memory/${section}.md`;
  } else if (
    section.startsWith('journal/day-') &&
    DAY_DIGITS.test(section.slice('journal/day-'.length))
  ) {
    file = `memory/${section}.md`;
  }
  if (file === null || !isAllowedPath(file, 'setup')) return null;
  return file;
}
