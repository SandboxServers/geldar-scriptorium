/**
 * How CI splits the vitest run across jobs. Every test file belongs to exactly one group: the
 * named groups claim files by path, and `rest` takes everything else, so a new test file can
 * never fall out of CI. `e2e` is its own job (it needs GELDAR_E2E=1 and is the longest file).
 */
import { execFileSync } from 'node:child_process';

// Mirrors `test.include` and `test.exclude` in vitest.config.ts (a test compares them).
export const INCLUDE_SUFFIX = '.test.ts';
export const INCLUDE_DIRS = ['/src/', '/test/', 'tests/'];
export const EXCLUDE_PARTS = ['node_modules/', '/dist/', '.claude/worktrees/'];

export interface Group {
  name: string;
  /** Runs in the `tests` matrix; false for the groups with their own job. */
  matrix: boolean;
  /** Path prefixes or exact paths this group claims; `rest` claims what no other does. */
  claims: string[];
}

// Order matters: the first group that claims a path wins. Balanced on Wave 5 timings
// (pre 303 s, bundle 235 s, finish 229 s, commands 178 s; session, new, core, setup 70-140 s).
export const GROUPS: Group[] = [
  { name: 'e2e', matrix: false, claims: ['tests/e2e/'] },
  { name: 'hostile', matrix: true, claims: ['launcher/test/hostile/'] },
  {
    name: 'launcher-heavy',
    matrix: true,
    claims: [
      'launcher/test/pre.test.ts',
      'launcher/test/bundle.test.ts',
      'launcher/test/finish.test.ts',
      'launcher/test/commands.test.ts',
    ],
  },
  { name: 'launcher', matrix: true, claims: ['launcher/test/'] },
  { name: 'image', matrix: true, claims: ['tests/image/', 'tests/hostile/', 'tests/template/'] },
  { name: 'rest', matrix: true, claims: [] },
];

export function isTestFile(path: string): boolean {
  if (!path.endsWith(INCLUDE_SUFFIX)) return false;
  if (EXCLUDE_PARTS.some((part) => `/${path}`.includes(`/${part}`))) return false;
  return INCLUDE_DIRS.some((dir) =>
    dir.startsWith('/') ? path.includes(dir) : path.startsWith(dir),
  );
}

export function groupOf(path: string): string {
  for (const group of GROUPS) {
    if (
      group.claims.some(
        (claim) => path === claim || (claim.endsWith('/') && path.startsWith(claim)),
      )
    ) {
      return group.name;
    }
  }
  return 'rest';
}

export function assign(files: string[]): Map<string, string[]> {
  const out = new Map(GROUPS.map((group) => [group.name, [] as string[]]));
  for (const file of files) out.get(groupOf(file))?.push(file);
  return out;
}

/** Tracked and untracked (not ignored) test files, repo-relative with forward slashes. */
export function listTestFiles(): string[] {
  const raw = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.test.ts'],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return raw
    .split('\0')
    .filter((path) => path !== '' && isTestFile(path))
    .sort();
}
