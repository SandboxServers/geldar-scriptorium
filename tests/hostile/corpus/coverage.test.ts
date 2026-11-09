import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { corpusDir, manifest } from './corpus.ts';

const repo = join(corpusDir, '..', '..', '..');

// The contract table of the packet, copied literally (neither repo chooses anything).
const table: Record<string, { canary: string; fake: string[]; h: string[] }> = {
  'MB-01': { canary: 'CANARY-MB01-7c3e91a4', fake: [], h: ['H-06', 'H-09', 'H-10', 'H-11'] },
  'MB-02': { canary: 'CANARY-MB02-1d5b08f6', fake: [], h: ['H-08', 'H-11'] },
  'MB-03': { canary: 'CANARY-MB03-a94c2e17', fake: [], h: ['H-11', 'H-13'] },
  'MB-04': { canary: 'CANARY-MB04-5e07d3b9', fake: ['fake-secret-c81f4a26'], h: ['H-08', 'H-20'] },
  'MB-05': { canary: 'CANARY-MB05-92b6f0d1', fake: [], h: ['accepted risk'] },
  'MB-06': { canary: 'CANARY-MB06-e3a8175c', fake: [], h: ['H-06'] },
  'MB-07': { canary: 'CANARY-MB07-48d2c6fa', fake: [], h: ['H-08', 'H-20'] },
  'MB-08': { canary: 'CANARY-MB08-b05e9371', fake: ['fake-secret-6d2a90ce'], h: ['H-08'] },
  'MB-09': { canary: 'CANARY-MB09-2f71ad84', fake: [], h: ['H-20'] },
};

function corpusFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? corpusFiles(p) : [p];
  });
}

describe('corpus manifest', () => {
  it('manifest ids are exactly MB-01 to MB-09', () => {
    expect(manifest.map((e) => e.id)).toEqual(Object.keys(table));
  });

  it('manifest canaries are unique, well shaped and equal to the table', () => {
    const canaries = manifest.map((e) => e.canary);
    expect(new Set(canaries).size).toBe(canaries.length);
    for (const e of manifest) {
      expect(e.canary).toMatch(/^CANARY-MB\d\d-[0-9a-f]{8}$/);
      expect(e.canary).toBe(table[e.id]?.canary);
    }
  });

  it('manifest fake secrets and forbidden markers are set', () => {
    for (const e of manifest) {
      expect(e.forbidden_markers.length).toBeGreaterThan(0);
      expect(e.fake_secrets).toEqual(table[e.id]?.fake);
    }
    expect(manifest.find((e) => e.id === 'MB-05')?.marker_regex).toBe('from now on[^.]{0,40}obey');
  });

  it('manifest h_items are expanded, single and exist in the hardening list', () => {
    const doc = readFileSync(join(repo, 'docs', 'launcher-hardening.md'), 'utf8');
    for (const e of manifest) {
      expect(e.h_items).toEqual(table[e.id]?.h);
      for (const h of e.h_items) {
        if (h === 'accepted risk') continue;
        expect(h).toMatch(/^H-\d\d$/);
        expect(doc).toContain(`- ${h}:`);
      }
    }
  });

  it('manifest names no IP other than 127.0.0.1 and no host other than canary.invalid', () => {
    const files = corpusFiles(corpusDir).filter((f) => !f.endsWith('coverage.test.ts'));
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const ip of text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [])
        expect(ip, f).toBe('127.0.0.1');
      for (const m of text.matchAll(/https?:\/\/([^\s/'"`:]+)/g))
        expect(m[1], f).toBe('canary.invalid');
    }
  });
});

describe('corpus coverage', () => {
  it('each class has a gullible script or a grep-checked enforcing marker', () => {
    for (const e of manifest) {
      const script = e.gullible ? existsSync(join(corpusDir, 'gullible', e.gullible)) : false;
      const marked = e.enforced_by.some(
        (r) =>
          r.marker === `// corpus: ${e.id}` &&
          existsSync(join(repo, r.file)) &&
          readFileSync(join(repo, r.file), 'utf8').includes(r.marker),
      );
      expect(script || marked, `${e.id} is not covered`).toBe(true);
    }
  });
});

describe('corpus geldar index', () => {
  const index = join(
    repo,
    '..',
    'geldar',
    'threshold',
    'mcp-mock',
    'scenarios',
    'malicious',
    'corpus.json',
  );
  // Soft cross-check: a stale or missing clone skips it; CI never requires it.
  it.skipIf(!existsSync(index))('manifest rows agree with the geldar index', () => {
    const rows = JSON.parse(readFileSync(index, 'utf8')) as {
      id: string;
      canary: string;
      forbidden_markers: string[];
      marker_regex: string | null;
    }[];
    expect(rows.map((r) => r.id)).toEqual(manifest.map((e) => e.id));
    for (const r of rows) {
      const e = manifest.find((m) => m.id === r.id);
      expect(e?.canary).toBe(r.canary);
      expect(e?.forbidden_markers).toEqual(r.forbidden_markers);
      expect(e?.marker_regex).toBe(r.marker_regex);
    }
  });
});
