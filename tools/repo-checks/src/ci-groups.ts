/**
 * How CI splits the vitest run across jobs. Every test file belongs to exactly one group: the
 * named groups claim files by path, and `rest` takes everything else, so a new test file can
 * never fall out of CI. `e2e` is its own job (it needs GELDAR_E2E=1 and is the longest file).
 * Each group belongs to a family (a ci.yml job with its own scope flag in ci-scope.ts); the
 * `-c` shard of a launcher family claims by prefix, so a new file lands in it.
 */
import { execFileSync } from 'node:child_process';

// Mirrors `test.include` and `test.exclude` in vitest.config.ts (a test compares them).
export const INCLUDE_SUFFIX = '.test.ts';
export const INCLUDE_DIRS = ['/src/', '/test/', 'tests/'];
export const EXCLUDE_PARTS = ['node_modules/', '/dist/', '.claude/worktrees/'];

export interface Group {
  name: string;
  /** The ci.yml job that runs it: hostile, launcher, image, rest, or e2e (its own job). */
  family: string;
  /** Path prefixes (ending in `/`) or exact paths this group claims, in the order they are tried. */
  claims: string[];
}

const LAUNCHER = 'launcher/test/';

// Order matters: the first group that claims a path wins. Shards are balanced on the file
// timings of the last green run (seconds, summed per shard): hostile-a 525, hostile-b 524;
// launcher-a 764, launcher-b 777, launcher-c about 790 (its heavy files are from the older
// Wave 5 timings). Files with no timing are in the -c catch-all shards.
export const GROUPS: Group[] = [
  { name: 'e2e', family: 'e2e', claims: ['tests/e2e/'] },
  {
    name: 'hostile-a',
    family: 'hostile',
    claims: [
      `${LAUNCHER}hostile/h11-gate.test.ts`,
      `${LAUNCHER}hostile/h08-allowlist.test.ts`,
      `${LAUNCHER}hostile/h17-recovery.test.ts`,
    ],
  },
  {
    name: 'hostile-b',
    family: 'hostile',
    claims: [
      `${LAUNCHER}hostile/h13-recheck.test.ts`,
      `${LAUNCHER}hostile/devworld.pwsh.test.ts`,
      `${LAUNCHER}hostile/h14-push.test.ts`,
      `${LAUNCHER}hostile/h07-clivolume.test.ts`,
    ],
  },
  { name: 'hostile-c', family: 'hostile', claims: [`${LAUNCHER}hostile/`] },
  {
    name: 'launcher-a',
    family: 'launcher',
    claims: [
      `${LAUNCHER}upgrade.pwsh.test.ts`,
      `${LAUNCHER}session.test.ts`,
      `${LAUNCHER}new.test.ts`,
      `${LAUNCHER}core-timing.test.ts`,
    ],
  },
  {
    name: 'launcher-b',
    family: 'launcher',
    claims: [
      `${LAUNCHER}pre.test.ts`,
      `${LAUNCHER}upgrade.bash.test.ts`,
      `${LAUNCHER}core.test.ts`,
      `${LAUNCHER}setup.test.ts`,
      `${LAUNCHER}multi.test.ts`,
    ],
  },
  { name: 'launcher-c', family: 'launcher', claims: [LAUNCHER] },
  {
    name: 'image',
    family: 'image',
    claims: ['tests/image/', 'tests/hostile/', 'tests/template/'],
  },
  { name: 'rest', family: 'rest', claims: [] },
];

/** The ci.yml families that run vitest, in the order they appear in the workflow. */
export const FAMILIES = ['hostile', 'launcher', 'image', 'rest'];

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
