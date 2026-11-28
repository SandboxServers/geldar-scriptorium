import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkAssets, releasePlan, TEMPLATE_REPO } from './template-release.ts';

const TAG = 'kit-v0.1.0-rc2';
const ARCHIVE = 'geldar-play-0.1.0-rc2.tar.gz';
const README = resolve(import.meta.dirname, '../../../template/README.md');

let scratch: string;
let n = 0;

// A folder with the archive and a SHA256SUMS that names it (or extra files, if asked).
function folder(opts: { extra?: string; badSum?: boolean } = {}): string {
  const dir = join(scratch, `d${n++}`);
  mkdirSync(dir);
  const bytes = Buffer.from('not really a tarball');
  const sum = opts.badSum ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(dir, ARCHIVE), bytes);
  writeFileSync(join(dir, 'SHA256SUMS'), `${sum}  ${ARCHIVE}\n`);
  if (opts.extra) writeFileSync(join(dir, opts.extra), 'x');
  return dir;
}

const flag = (args: string[], f: string): string | undefined => {
  const i = args.indexOf(f);
  return i < 0 ? undefined : args[i + 1];
};

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'geldar-template-release-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('template-release (the launcher release in the template repo)', () => {
  it('creates the release in the template repository and no other', () => {
    const { args } = releasePlan(TAG);
    expect(args.slice(0, 3)).toEqual(['release', 'create', TAG]);
    expect(flag(args, '--repo')).toBe(TEMPLATE_REPO);
    expect(TEMPLATE_REPO).toBe('SandboxServers/geldar-player-template');
    expect(args).toContain('--verify-tag');
  });

  it('uploads exactly the archive and SHA256SUMS', () => {
    const { args, files } = releasePlan(TAG);
    expect(files).toEqual([ARCHIVE, 'SHA256SUMS']);
    expect(args.slice(-2)).toEqual([ARCHIVE, 'SHA256SUMS']);
    expect(args.some((a) => a.includes('*'))).toBe(false);
  });

  it('marks a hyphenated tag as a prerelease and a plain one as final', () => {
    expect(releasePlan(TAG).args).toContain('--prerelease');
    expect(releasePlan('kit-v0.1.0').args).not.toContain('--prerelease');
  });

  it('titles the release Launcher <version> with player-voice notes only', () => {
    const { args } = releasePlan(TAG);
    expect(flag(args, '--title')).toBe('Launcher 0.1.0-rc2');
    const notes = flag(args, '--notes') ?? '';
    expect(notes).toBe('The geldar-play launcher 0.1.0-rc2 and its checksum.');
    expect(notes.toLowerCase()).not.toContain('scriptorium');
  });

  it('refuses a tag that is not a kit version', () => {
    for (const bad of ['kit-v0.1', 'v0.1.0', 'kit-v0.1.0/../x', 'kit-v01.0.0', '']) {
      expect(() => releasePlan(bad)).toThrow(/bad tag/);
    }
  });

  it('accepts a folder with exactly the two files and a matching checksum', () => {
    expect(() => checkAssets(folder(), releasePlan(TAG))).not.toThrow();
  });

  it('refuses an extra file in the launcher folder, the SBOM for one', () => {
    const dir = folder({ extra: 'sbom.spdx.json' });
    expect(() => checkAssets(dir, releasePlan(TAG))).toThrow(/exactly/);
  });

  it('refuses a checksum that does not match the archive', () => {
    expect(() => checkAssets(folder({ badSum: true }), releasePlan(TAG))).toThrow(/does not match/);
  });

  it('keeps the README link on the repository that gets the release', () => {
    const readme = readFileSync(README, 'utf8');
    const m = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/releases\b/.exec(readme);
    expect(m?.[1]).toBe(TEMPLATE_REPO);
    expect(flag(releasePlan(TAG).args, '--repo')).toBe(m?.[1]);
  });
});
