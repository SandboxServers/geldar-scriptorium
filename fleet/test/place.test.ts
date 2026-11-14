import { execFile, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Tests for fleet/bin/place.sh and the lib/common.sh helpers it uses. Each run gets a temp root
// (GEL_ROOT), a fake df (GEL_DF) and a fake wrapper (GEL_RUN, fleet/test/fake-run.sh).
const fleet = fileURLToPath(new URL('..', import.meta.url));
const placeSh = join(fleet, 'bin', 'place.sh');
const commonSh = join(fleet, 'lib', 'common.sh');
const fakeRun = join(fleet, 'test', 'fake-run.sh');
const win = process.platform === 'win32';

function ciRequiresShells(ci: string | undefined): boolean {
  return ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false';
}

function hasTool(cmd: string, args: string[]): boolean {
  return spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
}

// win32 is not probed: its bash.exe is the WSL launcher, and the fleet runs on Debian.
const missingBash = win
  ? 'win32: fleet scripts run under Debian bash'
  : hasTool('bash', ['--version'])
    ? undefined
    : 'bash is missing';
const missingFlock =
  missingBash ?? (hasTool('flock', ['--version']) ? undefined : 'flock is missing');

// Locally a missing tool skips with a visible reason. Under CI it fails, so a skipped test can
// never pass there.
function runnable(missing: string | undefined): boolean {
  if (missing === undefined) return true;
  if (ciRequiresShells(process.env.CI)) throw new Error(`fleet test cannot run: ${missing}`);
  console.warn(`SKIPPED: ${missing}`);
  return false;
}

function shellTest(
  name: string,
  body: () => void | Promise<void>,
  missing: string | undefined = missingBash,
): void {
  it(name, async () => {
    if (!runnable(missing)) return;
    await body();
  }, 60_000);
}

interface World {
  root: string;
  runLog: string;
  dfLog: string;
  fakeDf: string;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

const roots: string[] = [];

// makeWorld: a temp root with fleet.conf and a fake df that reads per-volume fixtures.
function makeWorld(maxHosts = '5', minFree = '10'): World {
  const root = mkdtempSync(join(tmpdir(), 'fleet-place-'));
  roots.push(root);
  for (const d of ['etc/geldar/roster', 'etc/geldar/placement', 'run/geldar-fleet', 'dfdata']) {
    mkdirSync(join(root, d), { recursive: true });
  }
  writeFileSync(
    join(root, 'etc/geldar/fleet.conf'),
    `max_hosts=${maxHosts}\nmin_free_pct=${minFree}\n`,
  );
  const fakeDf = join(root, 'fake-df.sh');
  writeFileSync(
    fakeDf,
    [
      '#!/usr/bin/env bash',
      '# Fake df: the df shape from the fixture for the volume named by the path.',
      'here=$(cd "$(dirname "$0")" && pwd)',
      'name=$(basename "$1")',
      'echo "$name" >>"$here/df.log"',
      "printf '%s\\n' '    Avail     1B-blocks'",
      'cat "$here/dfdata/$name"',
      '',
    ].join('\n'),
  );
  chmodSync(fakeDf, 0o755);
  const w: World = {
    root,
    runLog: join(root, 'run.log'),
    dfLog: join(root, 'df.log'),
    fakeDf,
  };
  for (const v of ['nvme-d', 'nvme-e', 'nvme-g']) setFree(w, v, 50);
  return w;
}

// setFree: a volume of 1000 bytes with pct percent free (avail = pct * 10).
function setFree(w: World, volume: string, pct: number): void {
  writeFileSync(join(w.root, 'dfdata', volume), `${pct * 10} 1000\n`);
}

function roster(w: World, id: string, text = `acme/player-${id}\n`): void {
  writeFileSync(join(w.root, 'etc/geldar/roster', id), text);
}

function placement(w: World, id: string): string | undefined {
  const p = join(w.root, 'etc/geldar/placement', id);
  return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
}

// envFor: the seams are passed only when internal; without GELDAR_INTERNAL they must be ignored.
function envFor(w: World, internal = true): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: w.root,
    GEL_ROOT: w.root,
    GEL_DF: w.fakeDf,
    GEL_RUN: fakeRun,
    FAKE_RUN_LOG: w.runLog,
  };
  if (internal) env.GELDAR_INTERNAL = '1';
  return env;
}

function run(w: World, args: string[], internal = true): Run {
  const r = spawnSync('bash', [placeSh, ...args], {
    env: envFor(w, internal),
    encoding: 'utf8',
  });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function runAsync(w: World, args: string[]): Promise<Run> {
  return new Promise((done) => {
    execFile(
      'bash',
      [placeSh, ...args],
      { env: envFor(w), encoding: 'utf8' },
      (err, stdout, stderr) => {
        done({ status: err ? Number(err.code) : 0, stdout, stderr });
      },
    );
  });
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('geldar-fleet-place', () => {
  shellTest('invalid ids exit 2 before any filesystem or launcher action', () => {
    const w = makeWorld();
    for (const id of ['AG-x', 'ag-', 'ag-a b', '../x', 'ag-a-', `ag-${'a'.repeat(37)}`]) {
      const r = run(w, [id]);
      expect(r.status, id).toBe(2);
      expect(r.stdout, id).toBe('');
    }
    expect(existsSync(w.runLog)).toBe(false);
    expect(existsSync(w.dfLog)).toBe(false);
  });

  shellTest('a low volume is skipped, one at exactly min_free_pct is kept', () => {
    const w = makeWorld('5', '10');
    setFree(w, 'nvme-d', 5);
    setFree(w, 'nvme-e', 50);
    setFree(w, 'nvme-g', 30);
    expect(run(w, ['ag-a-01']).stdout).toBe('volume=nvme-e free_pct=50\n');

    setFree(w, 'nvme-d', 10);
    setFree(w, 'nvme-e', 9);
    setFree(w, 'nvme-g', 9);
    const r = run(w, ['ag-a-01']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('volume=nvme-d free_pct=10\n');
  });

  shellTest('all volumes low exits 3 and names the threshold', () => {
    const w = makeWorld('5', '10');
    for (const v of ['nvme-d', 'nvme-e', 'nvme-g']) setFree(w, v, 5);
    const r = run(w, ['ag-a-01']);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('10%');
    expect(r.stdout).toBe('');
  });

  shellTest('an existing placement stays after free space changes', () => {
    const w = makeWorld();
    roster(w, 'ag-a-01');
    const first = run(w, ['ag-a-01', '--reserve']);
    expect(first.status).toBe(0);
    expect(first.stdout).toBe('volume=nvme-d free_pct=50\n');
    expect(placement(w, 'ag-a-01')).toBe('volume=nvme-d\nrepo=acme/player-ag-a-01\n');

    setFree(w, 'nvme-d', 1);
    const again = run(w, ['ag-a-01']);
    expect(again.status).toBe(0);
    expect(again.stdout).toBe('volume=nvme-d free_pct=1\n');
  });

  shellTest('--reserve at the max_hosts cap exits 5 and writes nothing', () => {
    const w = makeWorld('1');
    roster(w, 'ag-a-01');
    roster(w, 'ag-b-01');
    writeFileSync(
      join(w.root, 'etc/geldar/placement/ag-a-01'),
      'volume=nvme-e\nrepo=acme/player-ag-a-01\n',
    );
    expect(run(w, ['ag-b-01', '--reserve']).status).toBe(5);
    expect(placement(w, 'ag-b-01')).toBeUndefined();
  });

  shellTest(
    'two concurrent reserves: one wins, the other waits and then sees the cap',
    async () => {
      const w = makeWorld('1');
      roster(w, 'ag-a-01');
      roster(w, 'ag-b-01');
      const results = await Promise.all([
        runAsync(w, ['ag-a-01', '--reserve']),
        runAsync(w, ['ag-b-01', '--reserve']),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([0, 5]);
      const written = readdirSync(join(w.root, 'etc/geldar/placement')).filter(
        (f) => !f.startsWith('.'),
      );
      expect(written).toHaveLength(1);
    },
    missingFlock,
  );

  shellTest('a roster with a CR or two lines exits 2', () => {
    const w = makeWorld();
    roster(w, 'ag-a-01', 'acme/player-ag-a-01\r\n');
    expect(run(w, ['ag-a-01', '--reserve']).status).toBe(2);
    roster(w, 'ag-a-01', 'acme/player-ag-a-01\nacme/other\n');
    expect(run(w, ['ag-a-01', '--reserve']).status).toBe(2);
    expect(placement(w, 'ag-a-01')).toBeUndefined();
  });

  shellTest('FILL_ME in max_hosts exits 5', () => {
    const w = makeWorld('FILL_ME');
    roster(w, 'ag-a-01');
    expect(run(w, ['ag-a-01', '--reserve']).status).toBe(5);
    expect(placement(w, 'ag-a-01')).toBeUndefined();
  });

  shellTest('the test seams are ignored without GELDAR_INTERNAL=1', () => {
    const w = makeWorld();
    roster(w, 'ag-a-01');
    // Without the flag the fixture root and fake df must not be used: no df call, no placement.
    expect(run(w, ['ag-a-01', '--reserve'], false).status).not.toBe(0);
    expect(existsSync(w.dfLog)).toBe(false);
    expect(placement(w, 'ag-a-01')).toBeUndefined();
    // Control: the same fixture with the flag does reserve.
    expect(run(w, ['ag-a-01', '--reserve']).status).toBe(0);
    expect(existsSync(w.dfLog)).toBe(true);
  });

  shellTest('gf_run reaches GEL_RUN only with GELDAR_INTERNAL=1 and maps failures to 7', () => {
    const w = makeWorld();
    const call = (verb: string, internal: boolean, extra: Record<string, string> = {}) =>
      spawnSync('bash', ['-c', '. "$1"; gf_run "$2" ag-a-01', 'x', commonSh, verb], {
        env: { ...envFor(w, internal), ...extra },
        encoding: 'utf8',
      });
    expect(call('start', false).status).toBe(7);
    expect(existsSync(w.runLog)).toBe(false);
    expect(call('start', true).status).toBe(0);
    expect(readFileSync(w.runLog, 'utf8')).toContain('start\tag-a-01');
    expect(call('start', true, { FAKE_RUN_EXIT: '3' }).status).toBe(7);
    expect(call('check-secrets', true, { FAKE_RUN_MISSING: '1' }).status).toBe(6);
  });

  shellTest('a reserved placement file is private to its owner', () => {
    const w = makeWorld();
    roster(w, 'ag-a-01');
    expect(run(w, ['ag-a-01', '--reserve']).status).toBe(0);
    const mode = statSync(join(w.root, 'etc/geldar/placement/ag-a-01')).mode & 0o777;
    expect(mode & 0o077).toBe(0);
  });
});
