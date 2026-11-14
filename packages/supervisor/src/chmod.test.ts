import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { makeFixture, onPoll } from './fixture.ts';

// A chmod on a file the supervisor does not own is EPERM in the container; it must never abort the tidy.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    // Only the journal files fail; the state files the supervisor owns still change mode.
    chmodSync: vi.fn((path: string, mode: number) => {
      if (String(path).includes('journal')) {
        throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      }
      actual.chmodSync(path, mode);
    }),
  };
});

describe('the tidy when chmod fails with EPERM', () => {
  it('still completes the archive step and launches the tidy', async () => {
    const f = makeFixture({ tools: 3 }, { GELDAR_TIDY_BYTES: '1000', GELDAR_RUN_MAX_FAILS: '99' });
    const dir = join(f.root, 'ws/memory/journal');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'current.md'), `# Journal\n${'x'.repeat(2000)}`);
    onPoll(f, () => f.supervisor.requestStop());
    await f.supervisor.run();
    expect(existsSync(join(dir, 'pending.md'))).toBe(true);
    expect(readFileSync(join(dir, 'pending.md'), 'utf8')).toContain('xxxx');
    expect(f.runs()).toHaveLength(1);
    expect(f.runs()[0]?.env.GELDAR_RUN_MAX_TURNS).toBe('40');
    expect(f.read('supervisor.log')).not.toContain('tidy skipped');
  });
});
