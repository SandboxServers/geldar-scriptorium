import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL, outputLines, parsePaths, scopeFor } from './ci-scope.ts';

const cli = fileURLToPath(new URL('./ci-scope-cli.ts', import.meta.url));

/** Every vitest family and e2e, off: the shape of a markdown-only change outside the suites. */
const NONE = { hostile: false, launcher: false, image: false, rest: false, e2e: false };

describe('scopeFor: docs-only changes', () => {
  it('a docs-only change turns every test family off, and still lints markdown', () => {
    expect(scopeFor(['docs/analysis/scriptorium/RESUME.md'])).toEqual({
      static: true,
      ...NONE,
      markdown: true,
    });
    expect(scopeFor(['.claude/agent-memory/main-session/MEMORY.md', 'docs/analysis/x.md'])).toEqual(
      { static: true, ...NONE, markdown: true },
    );
  });

  it('a non-markdown file under docs/analysis is not docs-only (fails open to rest)', () => {
    const scope = scopeFor(['docs/analysis/scriptorium/diagram.png']);
    expect(scope.rest).toBe(true);
    expect(scope.hostile).toBe(false);
  });

  it('a markdown file outside the docs folders is not docs-only', () => {
    expect(scopeFor(['docs/release.md']).rest).toBe(true);
  });

  it('a root markdown file no test reads turns every test family off', () => {
    expect(scopeFor(['README.md'])).toEqual({ static: true, ...NONE, markdown: true });
  });
});

describe('scopeFor: launcher-side changes', () => {
  it('a launcher file turns hostile, launcher, image and rest on', () => {
    const scope = scopeFor(['launcher/src/pre.ts']);
    expect(scope.hostile).toBe(true);
    expect(scope.launcher).toBe(true);
    expect(scope.image).toBe(true);
    expect(scope.rest).toBe(true);
    expect(scope.e2e).toBe(true);
    expect(scope.markdown).toBe(false);
  });

  it('a hostile test file turns the hostile and launcher families on', () => {
    const scope = scopeFor(['launcher/test/hostile/h11-gate.test.ts']);
    expect(scope.hostile).toBe(true);
    expect(scope.launcher).toBe(true);
  });

  it('a test-only change in a plain tests folder runs image and rest but not hostile or e2e', () => {
    const scope = scopeFor(['tests/image/cli.test.ts']);
    expect(scope.image).toBe(true);
    expect(scope.rest).toBe(true);
    expect(scope.hostile).toBe(false);
    expect(scope.launcher).toBe(false);
    expect(scope.e2e).toBe(false);
  });

  it('a tools change runs rest and image, not the launcher families', () => {
    const scope = scopeFor(['tools/repo-checks/src/ci-scope.ts']);
    expect(scope.rest).toBe(true);
    expect(scope.image).toBe(true);
    expect(scope.hostile).toBe(false);
    expect(scope.launcher).toBe(false);
  });

  it('a release tool change turns the launcher families on', () => {
    expect(scopeFor(['tools/release/cut.ts']).launcher).toBe(true);
  });

  it('a workflow edit turns every test family and e2e on', () => {
    expect(scopeFor(['.github/workflows/ci.yml'])).toEqual({
      ...ALL,
      markdown: false,
    });
  });

  it('toolchain and config files turn every test family and e2e on', () => {
    for (const path of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.nvmrc',
      'vitest.config.ts',
      'tsconfig.base.json',
      'tools/repo-checks/tsconfig.json',
    ]) {
      const scope = scopeFor([path]);
      expect(scope.hostile, path).toBe(true);
      expect(scope.e2e, path).toBe(true);
    }
  });

  it('static is on for every input', () => {
    expect(scopeFor(['docs/analysis/x.md']).static).toBe(true);
    expect(scopeFor([]).static).toBe(true);
  });
});

describe('scopeFor: markdown under the player kit', () => {
  it('a markdown file under template/ runs rest and image, not the launcher families', () => {
    const scope = scopeFor(['template/memory/goals.md']);
    expect(scope.markdown).toBe(true);
    expect(scope.rest).toBe(true);
    expect(scope.image).toBe(true);
    expect(scope.e2e).toBe(true);
    expect(scope.hostile).toBe(false);
    expect(scope.launcher).toBe(false);
  });

  it('a README-only template change leaves hostile and launcher off', () => {
    const scope = scopeFor(['template/README.md']);
    expect(scope.hostile).toBe(false);
    expect(scope.launcher).toBe(false);
    expect(scope.rest).toBe(true);
  });

  it('a non-markdown template file turns hostile and launcher on', () => {
    const scope = scopeFor(['template/skills/x/SKILL.json']);
    expect(scope.hostile).toBe(true);
    expect(scope.launcher).toBe(true);
  });

  it('a markdown file the tests read (ci.md) runs rest and image only', () => {
    expect(scopeFor(['docs/ci.md'])).toEqual({
      static: true,
      hostile: false,
      launcher: false,
      image: true,
      rest: true,
      e2e: false,
      markdown: true,
    });
  });
});

describe('scopeFor: fail open', () => {
  it('an empty list runs everything', () => {
    expect(scopeFor([])).toEqual(ALL);
  });

  it('a list that is not an array, or holds a bad entry, runs everything', () => {
    expect(scopeFor(undefined)).toEqual(ALL);
    expect(scopeFor('docs/analysis/x.md')).toEqual(ALL);
    expect(scopeFor(['docs/analysis/x.md', 7])).toEqual(ALL);
    expect(scopeFor(['docs/analysis/x.md', ''])).toEqual(ALL);
  });

  it('parsePaths drops blank lines and CR, and an empty text runs everything', () => {
    expect(parsePaths('a.md\r\n\nb/c.ts\n')).toEqual(['a.md', 'b/c.ts']);
    expect(scopeFor(parsePaths(''))).toEqual(ALL);
  });
});

describe('ci-scope cli', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scope-'));

  it('prints key=value lines for a docs-only file list', () => {
    const file = join(dir, 'docs.txt');
    writeFileSync(file, 'docs/analysis/x.md\n');
    const run = spawnSync(process.execPath, [cli, file], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout.trim().split('\n')).toEqual([
      'static=true',
      'hostile=false',
      'launcher=false',
      'image=false',
      'rest=false',
      'e2e=false',
      'markdown=true',
    ]);
  });

  it('prints every job on when the file cannot be read', () => {
    const run = spawnSync(process.execPath, [cli, join(dir, 'missing.txt')], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout.trim().split('\n')).toEqual(outputLines(ALL));
  });
});
