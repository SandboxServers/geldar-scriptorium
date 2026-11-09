import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import config from '../../../vitest.config.ts';
import {
  assign,
  EXCLUDE_PARTS,
  GROUPS,
  groupOf,
  INCLUDE_DIRS,
  isTestFile,
  listTestFiles,
} from './ci-groups.ts';

const ci = parse(
  readFileSync(
    fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url)),
    'utf8',
  ),
);

describe('ci test groups', () => {
  it('mirror the include and exclude globs of vitest.config.ts', () => {
    const test = config.test ?? {};
    expect(test.include).toEqual([
      '**/src/**/*.test.ts',
      '**/test/**/*.test.ts',
      'tests/**/*.test.ts',
    ]);
    expect(INCLUDE_DIRS).toEqual(['/src/', '/test/', 'tests/']);
    expect(test.exclude).toEqual(['**/node_modules/**', '**/dist/**', '.claude/worktrees/**']);
    expect(EXCLUDE_PARTS).toHaveLength(3);
  });

  it('put every test file in exactly one group, none empty, so none can fall out of CI', () => {
    const files = listTestFiles();
    expect(files.length).toBeGreaterThan(50);
    const groups = assign(files);
    expect([...groups.values()].flat().sort()).toEqual(files);
    for (const [name, members] of groups) expect(members.length, name).toBeGreaterThan(0);
  });

  it('send a file nobody claims to rest, and e2e to its own group', () => {
    expect(groupOf('packages/brand-new/src/x.test.ts')).toBe('rest');
    expect(groupOf('tests/e2e/e2e.test.ts')).toBe('e2e');
    expect(groupOf('launcher/test/hostile/h01-clean.test.ts')).toBe('hostile');
    expect(groupOf('launcher/test/pre.test.ts')).toBe('launcher-heavy');
    expect(isTestFile('.claude/worktrees/x/src/a.test.ts')).toBe(false);
  });

  it('runs exactly the matrix groups in ci.yml, and e2e in its own job', () => {
    const matrix = ci.jobs.tests.strategy.matrix.group as string[];
    expect([...matrix].sort()).toEqual(
      GROUPS.filter((g) => g.matrix)
        .map((g) => g.name)
        .sort(),
    );
    expect(ci.jobs.tests.strategy['fail-fast']).toBe(false);
    expect(JSON.stringify(ci.jobs.e2e)).toContain('tests/e2e/$E2E_FILE');
  });

  it('gates on every job', () => {
    expect([...ci.jobs.gate.needs].sort()).toEqual(['e2e', 'static', 'tests']);
  });
});
