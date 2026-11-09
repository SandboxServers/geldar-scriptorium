import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isAllowedPath, type Mode } from '../../packages/path-rule/src/index.ts';

// The shared table of path cases. The bash and pwsh host re-checks run the same file, so a
// case that disagrees with the gate's rule fails here before it can mislead them.
interface PathCase {
  path: string;
  mode: Mode;
  allowed: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, 'path-cases.json'), 'utf8')) as PathCase[];

describe('path-cases.json', () => {
  it('has at least 40 cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });

  it('covers each H-11 bullet', () => {
    const paths = new Set(cases.map((c) => c.path));
    const needles = [
      'skills/con.md',
      'skills/NUL.json',
      'memory/aux.md',
      'memory/a./b.md',
      'memory/.gitattributes',
      'MEMORY/identity.md',
    ];
    for (const n of needles) expect(paths.has(n), n).toBe(true);
    const id = cases.filter((c) => c.path === 'memory/identity.md').map((c) => c.mode);
    expect(id.sort()).toEqual(['play', 'setup']);
    expect(cases.some((c) => c.path.length === 201)).toBe(true);
    expect(cases.some((c) => c.path.split('/').some((p) => p.length === 65))).toBe(true);
    expect(cases.some((c) => [...c.path].some((ch) => (ch.codePointAt(0) ?? 0) > 127))).toBe(true);
    expect(cases.some((c) => c.path.includes(String.fromCharCode(92)))).toBe(true);
    expect(cases.some((c) => c.path.includes('..'))).toBe(true);
  });

  it.each(cases.map((c) => [JSON.stringify(c.path), c] as const))(
    '%s agrees with isAllowedPath',
    (_n, c) => {
      expect(isAllowedPath(c.path, c.mode)).toBe(c.allowed);
    },
  );
});
