import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL, outputLines, parsePaths, scopeFor } from './ci-scope.ts';

const cli = fileURLToPath(new URL('./ci-scope-cli.ts', import.meta.url));

describe('scopeFor: docs-only changes', () => {
  it('a docs-only change skips tests and e2e, and still lints markdown', () => {
    expect(scopeFor(['docs/analysis/scriptorium/RESUME.md'])).toEqual({
      static: true,
      tests: false,
      e2e: false,
      markdown: true,
    });
    expect(scopeFor(['.claude/agent-memory/main-session/MEMORY.md', 'docs/analysis/x.md'])).toEqual(
      { static: true, tests: false, e2e: false, markdown: true },
    );
  });

  it('a non-markdown file under docs/analysis is not docs-only (fails open)', () => {
    expect(scopeFor(['docs/analysis/scriptorium/diagram.png']).tests).toBe(true);
  });

  it('a markdown file outside the docs folders is not docs-only', () => {
    expect(scopeFor(['docs/release.md']).tests).toBe(true);
  });
});

describe('scopeFor: code changes', () => {
  it('a launcher file turns tests and e2e on', () => {
    const scope = scopeFor(['launcher/src/pre.ts']);
    expect(scope.tests).toBe(true);
    expect(scope.e2e).toBe(true);
    expect(scope.markdown).toBe(false);
  });

  it('a workflow edit turns e2e on', () => {
    const scope = scopeFor(['.github/workflows/ci.yml']);
    expect(scope.e2e).toBe(true);
    expect(scope.tests).toBe(true);
  });

  it('toolchain and config files turn e2e on', () => {
    for (const path of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.nvmrc',
      'vitest.config.ts',
      'tsconfig.base.json',
      'tools/repo-checks/tsconfig.json',
    ]) {
      expect(scopeFor([path]).e2e, path).toBe(true);
    }
  });

  it('a test-only change in a plain tests folder runs tests but not e2e', () => {
    const scope = scopeFor(['tests/image/cli.test.ts']);
    expect(scope.tests).toBe(true);
    expect(scope.e2e).toBe(false);
  });

  it('static is on for every input', () => {
    expect(scopeFor(['docs/analysis/x.md']).static).toBe(true);
    expect(scopeFor([]).static).toBe(true);
  });
});

describe('scopeFor: markdown under the player kit', () => {
  it('a markdown file under template/ turns markdown and tests on', () => {
    const scope = scopeFor(['template/memory/goals.md']);
    expect(scope.markdown).toBe(true);
    expect(scope.tests).toBe(true);
    expect(scope.e2e).toBe(true);
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
      'tests=false',
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
