import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import config from '../../../vitest.config.ts';
import {
  assign,
  EXCLUDE_PARTS,
  FAMILIES,
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
    expect(isTestFile('.claude/worktrees/x/src/a.test.ts')).toBe(false);
  });

  it('send a new hostile or launcher file to that family catch-all shard', () => {
    expect(groupOf('launcher/test/hostile/brand-new.test.ts')).toBe('hostile-c');
    expect(groupOf('launcher/test/brand-new.test.ts')).toBe('launcher-c');
    expect(groupOf('launcher/test/hostile/h01-clean.test.ts')).toBe('hostile-c');
  });

  it('keep the timed heavy files in their balanced shards', () => {
    expect(groupOf('launcher/test/hostile/h11-gate.test.ts')).toBe('hostile-a');
    expect(groupOf('launcher/test/hostile/devworld.pwsh.test.ts')).toBe('hostile-b');
    expect(groupOf('launcher/test/upgrade.pwsh.test.ts')).toBe('launcher-a');
    expect(groupOf('launcher/test/pre.test.ts')).toBe('launcher-b');
    expect(groupOf('launcher/test/bundle.test.ts')).toBe('launcher-c');
  });

  it('give every group a family that ci.yml runs as a job', () => {
    for (const group of GROUPS) {
      expect(group.family === 'e2e' || FAMILIES.includes(group.family), group.name).toBe(true);
    }
  });

  it('runs each family as a ci.yml job with exactly its shards, gated by its scope flag', () => {
    for (const family of FAMILIES) {
      const job = ci.jobs[family];
      const shards = GROUPS.filter((g) => g.family === family).map((g) => g.name);
      expect([...job.strategy.matrix.group].sort(), family).toEqual([...shards].sort());
      expect(job.strategy['fail-fast'], family).toBe(false);
      expect(job.if, family).toBe(`needs.changes.outputs.${family} == 'true'`);
      expect(ci.jobs.changes.outputs, family).toHaveProperty(family);
    }
    expect(JSON.stringify(ci.jobs.e2e)).toContain('tests/e2e/$E2E_FILE');
  });

  it('gates on every job', () => {
    expect([...ci.jobs.gate.needs].sort()).toEqual(
      ['changes', 'e2e', 'hostile', 'image', 'launcher', 'markdown', 'rest', 'static'].sort(),
    );
  });
});
