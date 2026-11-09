import { closeSync, ftruncateSync, openSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { VerifyInput } from './args.ts';
import { type Fixture, makeFixture } from './fixture.ts';
import { MAX_BUNDLE_BYTES, verify } from './verify.ts';

const fixtures: Fixture[] = [];

function fresh(): Fixture {
  const f = makeFixture();
  fixtures.push(f);
  return f;
}

function input(f: Fixture, bundle: string, over: Partial<VerifyInput> = {}): VerifyInput {
  return {
    bundle,
    start: f.start,
    branch: 'main',
    mode: 'play',
    playerId: f.playerId,
    ...over,
  };
}

function scratchFolders(): string[] {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith('geldar-verify-'))
    .sort();
}

afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

describe('verify: clean sessions', () => {
  it('accepts a clean day', () => {
    const f = fresh();
    f.write('memory/summary.md', 'updated\n');
    f.write('memory/journal/day-001.md', 'day one\n');
    f.commitAll('day 1');
    const bundle = f.bundle(['refs/heads/main']);
    expect(verify(input(f, bundle))).toEqual({ ok: true, reasons: [] });
  });

  it('accepts a bundle with no new commits', () => {
    const f = fresh();
    const bundle = f.bundle(['refs/heads/main']);
    expect(verify(input(f, bundle))).toEqual({ ok: true, reasons: [] });
  });
});

describe('verify: bundle file', () => {
  it('rejects an oversize bundle', () => {
    const f = fresh();
    const path = join(f.out, 'big.bundle');
    const fd = openSync(path, 'w');
    ftruncateSync(fd, MAX_BUNDLE_BYTES + 1);
    closeSync(fd);
    expect(verify(input(f, path))).toEqual({ ok: false, reasons: ['bundle_too_large'] });
  });

  it('treats exactly the cap as readable, so the cap is strictly greater', () => {
    const f = fresh();
    // A short first line: git rejects it at once. A huge file with no newline makes git
    // crawl until the 60 s timeout, which is a different path (verify_error).
    const path = join(f.out, 'cap.bundle');
    writeFileSync(path, 'hello\n');
    const fd = openSync(path, 'r+');
    ftruncateSync(fd, MAX_BUNDLE_BYTES);
    closeSync(fd);
    expect(verify(input(f, path))).toEqual({ ok: false, reasons: ['bundle_unreadable'] });
  });

  it('rejects a missing file', () => {
    const f = fresh();
    const path = join(f.out, 'missing.bundle');
    expect(verify(input(f, path))).toEqual({ ok: false, reasons: ['bundle_unreadable'] });
  });

  it('rejects a text file that is not a bundle', () => {
    const f = fresh();
    const path = join(f.out, 'text.bundle');
    writeFileSync(path, 'hello\n');
    expect(verify(input(f, path))).toEqual({ ok: false, reasons: ['bundle_unreadable'] });
  });
});

describe('verify: refs', () => {
  it('rejects a bundle with two refs', () => {
    const f = fresh();
    f.git(['checkout', '-q', '-b', 'other']);
    f.write('memory/people/other.md', 'other\n');
    f.commitAll('other');
    f.git(['checkout', '-q', 'main']);
    const bundle = f.bundle(['refs/heads/main', 'refs/heads/other']);
    expect(verify(input(f, bundle))).toEqual({
      ok: false,
      reasons: ['bundle_refs_unexpected'],
    });
  });

  it('rejects a bundle whose only ref is the wrong branch', () => {
    const f = fresh();
    f.git(['branch', 'evil']);
    const bundle = f.bundle(['refs/heads/evil']);
    expect(verify(input(f, bundle))).toEqual({
      ok: false,
      reasons: ['bundle_refs_unexpected'],
    });
  });
});

describe('verify: history shape', () => {
  it('rejects a rewritten history as not fast-forward', () => {
    const f = fresh();
    f.git(['commit', '-q', '--amend', '--allow-empty', '-m', 'rewritten']);
    f.write('memory/summary.md', 'after rewrite\n');
    f.commitAll('after');
    const bundle = f.bundle(['refs/heads/main']);
    expect(verify(input(f, bundle))).toEqual({ ok: false, reasons: ['not_fast_forward'] });
  });

  it('rejects a START the bundle does not contain as not fast-forward', () => {
    const f = fresh();
    f.write('memory/summary.md', 'updated\n');
    f.commitAll('day 1');
    const bundle = f.bundle(['refs/heads/main']);
    expect(verify(input(f, bundle, { start: 'f'.repeat(40) }))).toEqual({
      ok: false,
      reasons: ['not_fast_forward'],
    });
  });

  it('rejects a merge commit', () => {
    const f = fresh();
    f.git(['checkout', '-q', '-b', 'side']);
    f.write('memory/people/side.md', 'side\n');
    f.commitAll('side');
    f.git(['checkout', '-q', 'main']);
    f.write('memory/goals.md', 'goal\n');
    f.commitAll('goals');
    f.git(['merge', '--no-ff', 'side', '-m', 'merge']);
    const bundle = f.bundle(['refs/heads/main']);
    expect(verify(input(f, bundle))).toEqual({ ok: false, reasons: ['merge_commit'] });
  });

  it('rejects a corrupt object as a failed fetch', () => {
    const f = fresh();
    const body = `tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\nparent ${f.start}\ncommitter x <x@example.test> 0 +0000\n\nm\n`;
    const file = join(f.out, 'bad-commit.txt');
    writeFileSync(file, body);
    const sha = f.git(['hash-object', '-t', 'commit', '--literally', '-w', file]);
    f.git(['update-ref', 'refs/heads/main', sha]);
    const bundle = f.bundle(['refs/heads/main']);
    expect(verify(input(f, bundle))).toEqual({
      ok: false,
      reasons: ['bundle_fetch_failed'],
    });
  });
});

describe('verify: commit cap', () => {
  function threeCommits(f: Fixture): string {
    for (let i = 1; i <= 3; i++) {
      f.write(`memory/journal/day-00${i}.md`, `day ${i}\n`);
      f.commitAll(`day ${i}`);
    }
    return f.bundle(['refs/heads/main']);
  }

  it('rejects more commits than the cap', () => {
    const f = fresh();
    const bundle = threeCommits(f);
    expect(verify(input(f, bundle), 2)).toEqual({ ok: false, reasons: ['too_many_commits'] });
  });

  it('accepts exactly the cap', () => {
    const f = fresh();
    const bundle = threeCommits(f);
    expect(verify(input(f, bundle), 3)).toEqual({ ok: true, reasons: [] });
  });
});

describe('verify: scratch folder', () => {
  it('leaves no scratch folder behind for ok or rejected runs', () => {
    const f = fresh();
    const clean = f.bundle(['refs/heads/main']);
    const before = scratchFolders();
    expect(verify(input(f, clean)).ok).toBe(true);
    expect(scratchFolders()).toEqual(before);

    const rejected = verify(input(f, clean, { start: 'f'.repeat(40) }));
    expect(rejected.ok).toBe(false);
    expect(scratchFolders()).toEqual(before);
  });
});
