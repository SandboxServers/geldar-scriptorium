import { describe, expect, it } from 'vitest';
import { type CollisionRow, collisionText, loadRows, startPaths } from './collision-suite.ts';

const fold = (p: string) => p.toLowerCase();

// Members of a path set: the files and every proper directory prefix of each.
function members(paths: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    const parts = p.split('/');
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'));
  }
  return out;
}

// Independent reference of the collision rule (decision 28), about the end tree only.
function refCollides(row: CollisionRow): boolean {
  const s = startPaths(row);
  const gone = new Set(row.delete ?? []);
  const e = new Set([...s.filter((p) => !gone.has(p)), ...row.add]);
  const ms = members(s);
  const me = [...members(e)];
  const byFold = new Map<string, string[]>();
  for (const m of me) byFold.set(fold(m), [...(byFold.get(fold(m)) ?? []), m]);
  for (const group of byFold.values())
    if (group.length > 1 && group.some((m) => !ms.has(m))) return true;
  return false;
}

describe('collision case table', () => {
  const rows = loadRows();

  it('has at least 24 rows with both outcomes', () => {
    expect(rows.length).toBeGreaterThanOrEqual(24);
    expect(rows.some((r) => r.collides)).toBe(true);
    expect(rows.some((r) => !r.collides)).toBe(true);
  });

  it('names are unique', () => {
    expect(new Set(rows.map((r) => r.name)).size).toBe(rows.length);
  });

  for (const row of rows)
    it(`reference agrees: ${row.name}`, () => {
      expect(refCollides(row)).toBe(row.collides);
    });

  it('the message row exists and is a fragment for recheck_failed', () => {
    expect(collisionText()).toBe(
      'a name differs only by upper and lower case from one you already have',
    );
  });
});
