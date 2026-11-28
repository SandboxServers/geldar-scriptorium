import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openForContainer } from './open-for-container.ts';

describe('openForContainer', () => {
  it('skips an entry that vanished after the directory was listed (#131)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geldar-ofc-'));
    try {
      mkdirSync(join(dir, 'objects'));
      writeFileSync(join(dir, 'objects', 'pack.idx'), 'x');
      const listing = (path: string) =>
        path === join(dir, 'objects') ? ['pack.idx', 'maintenance.lock'] : ['objects'];
      expect(() => openForContainer(dir, { readdir: listing })).not.toThrow();
      expect(statSync(join(dir, 'objects', 'pack.idx')).isFile()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still reports errors other than a vanished entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geldar-ofc-'));
    try {
      const boom = () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      };
      expect(() => openForContainer(dir, { readdir: boom })).toThrow('denied');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
