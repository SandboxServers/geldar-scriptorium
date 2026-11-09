import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { type Fixture, makeFixture } from './fixture.ts';

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const fixtures: Fixture[] = [];

afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

function cli(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 30_000 });
}

function argsFor(f: Fixture, bundle: string): string[] {
  return [
    '--bundle',
    bundle,
    '--start',
    f.start,
    '--branch',
    'main',
    '--mode',
    'play',
    '--player-id',
    f.playerId,
  ];
}

describe('geldar-verify command line', () => {
  it('exits 2 with bad_arguments when no arguments are given', () => {
    const result = cli([]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('{"ok":false,"reasons":["bad_arguments"]}\n');
  }, 30_000);

  it('exits 0 with the ok verdict for a clean bundle', () => {
    const f = makeFixture();
    fixtures.push(f);
    f.write('memory/summary.md', 'updated\n');
    f.commitAll('day 1');
    const bundle = f.bundle(['refs/heads/main']);
    const result = cli(argsFor(f, bundle));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('{"ok":true,"reasons":[]}\n');
  }, 30_000);

  it('exits 1 with bundle_refs_unexpected for a two-ref bundle', () => {
    const f = makeFixture();
    fixtures.push(f);
    f.git(['branch', 'other']);
    const bundle = f.bundle(['refs/heads/main', 'refs/heads/other']);
    const result = cli(argsFor(f, bundle));
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('{"ok":false,"reasons":["bundle_refs_unexpected"]}\n');
  }, 30_000);
});
