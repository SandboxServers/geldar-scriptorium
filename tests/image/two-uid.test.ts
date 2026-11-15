// The two user ids of a live host, run for real in the kit image: the player is uid 1000, the
// supervisor is uid 1001, and the supervisor runs with umask 027 (set by the player entrypoint).
// Covers SC-184 (the journal directory mode, set by the entrypoint) and SC-185 (the pending.md mode,
// set by prepareTidy). Named volumes are prepared by a root container, so no host uid is needed.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildKit, dockerPath, dockerReady, KIT_IMAGE, repoRoot, run } from './docker.ts';

const READY = dockerReady();
const PLAYER = '1000:1000';
const RUN_MS = 60_000;
const ENTRYPOINT = '/usr/local/bin/geldar-player-entrypoint';
const JOURNAL = '/player/memory/journal';

// The capabilities the player service adds, read from image/compose/player.yml (not copied here), so
// the test runs with the set the compose file grants and a change there changes the test too.
const composeText = readFileSync(path.resolve(repoRoot, 'image/compose/player.yml'), 'utf8');
const CAP_ADD = (/^ {2}player:\n[\s\S]*?^ {4}cap_add: \[(.*)\]$/m.exec(composeText)?.[1] ?? '')
  .split(', ')
  .filter(Boolean);

// The player service's hardening in image/compose/player.yml: cap_drop ALL, its capabilities,
// no-new-privileges, a read-only root filesystem, init, and no network.
function composeRun(): string[] {
  return [
    '--init',
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    '/tmp:mode=1777',
    '--cap-drop',
    'ALL',
    ...CAP_ADD.flatMap((cap) => ['--cap-add', cap]),
    '--security-opt',
    'no-new-privileges:true',
  ];
}

// A stand-in for geldar-supervisor: the entrypoint execs it as uid 1001 after its own work, and it
// tries the tidy's first step, the move of current.md to pending.md, in the journal directory.
const STAND_IN = `#!/bin/sh
echo "uid=$(id -u)"
if out=$(mv ${JOURNAL}/current.md ${JOURNAL}/pending.md 2>&1); then
  echo rename=ok
elif echo "$out" | grep -q 'Permission denied'; then
  echo rename=EACCES
else
  echo "rename=other: $out"
fi
`;

// A stand-in for geldar-supervisor that runs the real prepareTidy of the supervisor source, as the
// supervisor does during a tidy. TypeScript's `private` is erased at run time, so the method is
// callable from plain JavaScript. The real deps are used: prepareTidy starts no child process.
const TIDY_PROBE = `#!/usr/local/bin/node
(async () => {
  const { readSettings, realDeps, Supervisor } = await import(
    '/opt/geldar/packages/supervisor/src/index.ts'
  );
  const settings = readSettings({ GELDAR_WORKSPACE: '/player' });
  const supervisor = new Supervisor(settings, realDeps());
  console.log('uid=' + process.getuid());
  console.log('tidy=' + supervisor.prepareTidy());
})();
`;

// The four volumes the player service mounts, by their container paths.
interface Workspace {
  player: string;
  cli: string;
  state: string;
  keeper: string;
}

const volumes: string[] = [];
const containers: string[] = [];
let containerSerial = 0;
let hostDir = '';
let standIn = '';
let probe = '';

function newVolume(): string {
  const name = `geldar-two-uid-${process.pid}-${Date.now()}-${volumes.length}`;
  const r = run(['volume', 'create', name]);
  expect(r.status, r.stderr).toBe(0);
  volumes.push(name);
  return name;
}

function newWorkspace(): Workspace {
  return { player: newVolume(), cli: newVolume(), state: newVolume(), keeper: newVolume() };
}

// The start of a `docker run` with a name, so a timed-out run can be removed in afterEach.
function runArgs(): string[] {
  const name = `geldar-two-uid-${process.pid}-${Date.now()}-${containerSerial++}`;
  containers.push(name);
  return ['run', '--rm', '--name', name];
}

function mounts(w: Workspace): string[] {
  return [
    '-v',
    `${w.player}:/player`,
    '-v',
    `${w.cli}:/cli-home`,
    '-v',
    `${w.state}:/state/supervisor`,
    '-v',
    `${w.keeper}:/keeper-state:ro`,
  ];
}

// Runs a shell script as root (the full default capability set) in the kit image, to prepare volumes.
function prepare(w: Workspace, script: string): void {
  const r = run([
    ...runArgs(),
    '--user',
    '0:0',
    ...mounts(w),
    '--entrypoint',
    'sh',
    KIT_IMAGE,
    '-c',
    script,
  ]);
  expect(r.status, r.stderr).toBe(0);
}

// The octal mode of a path in the player's workspace.
function modeOf(w: Workspace, p: string): number {
  const r = run([
    ...runArgs(),
    '-v',
    `${w.player}:/player`,
    '--entrypoint',
    'stat',
    KIT_IMAGE,
    '-c',
    '%a',
    p,
  ]);
  expect(r.status, r.stderr).toBe(0);
  return Number.parseInt(r.stdout.trim(), 8);
}

// Runs the real player entrypoint as the compose service does: root, the compose caps, and the given
// file mounted over geldar-supervisor (the entrypoint execs it as uid 1001 with the real umask 027).
function enter(w: Workspace, binary: string) {
  return run(
    [
      ...runArgs(),
      ...composeRun(),
      '--user',
      '0:0',
      '-e',
      'HOME=/tmp',
      '-e',
      'GELDAR_MODE=play',
      ...mounts(w),
      '-v',
      `${dockerPath(binary)}:/usr/local/bin/geldar-supervisor:ro`,
      '--entrypoint',
      ENTRYPOINT,
      KIT_IMAGE,
    ],
    { timeoutMs: RUN_MS },
  );
}

// A workspace as the tidy finds it: a pending.md the tidy left (owned by the player, mode 0644), a
// current.md with the day's entries, and a journal directory the entrypoint has made writable (0777).
function pendingWorkspace(): Workspace {
  const w = newWorkspace();
  prepare(
    w,
    `mkdir -p ${JOURNAL} && printf 'old\\n' > ${JOURNAL}/pending.md && printf 'new\\n' > ${JOURNAL}/current.md && chown -R 1000:1000 /player && chmod 0777 ${JOURNAL} && chmod 0644 ${JOURNAL}/pending.md`,
  );
  return w;
}

beforeAll(() => {
  if (!READY) return;
  buildKit();
  hostDir = mkdtempSync(path.join(tmpdir(), 'geldar-two-uid-'));
  standIn = writeExecutable('geldar-supervisor', STAND_IN);
  probe = writeExecutable('geldar-supervisor-tidy', TIDY_PROBE);
}, 900_000);

// Writes a file the container's uid 1001 must run. The host umask (077 would leave 0700) must not
// decide the mode, so the mode is set after the write.
function writeExecutable(name: string, text: string): string {
  const file = path.join(hostDir, name);
  writeFileSync(file, text, { mode: 0o755 });
  chmodSync(file, 0o755);
  return file;
}

afterEach(() => {
  for (const name of containers.splice(0)) run(['rm', '-f', name]);
  for (const name of volumes.splice(0)) run(['volume', 'rm', '-f', name]);
});

afterAll(() => {
  if (hostDir !== '') rmSync(hostDir, { recursive: true, force: true });
});

describe.skipIf(!READY)('SC-184: the supervisor renames current.md under the real uids', () => {
  it('the player service grants the capabilities player.yml names, and no others', () => {
    expect(CAP_ADD).toEqual(['CHOWN', 'FOWNER', 'FSETID', 'SETUID', 'SETGID', 'SETPCAP']);
  });

  it('the entrypoint makes the journal directory writable, so uid 1001 can move current.md', () => {
    const w = newWorkspace();
    prepare(
      w,
      `mkdir -p ${JOURNAL} && printf '# Journal\\n' > ${JOURNAL}/current.md && chown -R 1000:1000 /player && chmod 0755 ${JOURNAL}`,
    );
    const r = enter(w, standIn);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('uid=1001');
    expect(r.stdout).toContain('rename=ok');
    expect(modeOf(w, JOURNAL)).toBe(0o777);
  });

  it('a journal that is a symlink to another directory is left alone (the guard)', () => {
    const w = newWorkspace();
    prepare(
      w,
      `mkdir -p /player/memory /player/other && printf '# Journal\\n' > /player/other/current.md && ln -s /player/other ${JOURNAL} && chown -R 1000:1000 /player && chmod 0755 /player/other`,
    );
    const r = enter(w, standIn);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('rename=EACCES');
    expect(modeOf(w, '/player/other')).toBe(0o755);
  });
});

describe.skipIf(!READY)('SC-185: pending.md is readable by the player after a tidy', () => {
  it('the real prepareTidy, run as uid 1001 through the entrypoint, leaves pending.md readable by uid 1000', () => {
    const w = pendingWorkspace();
    const tidy = enter(w, probe);
    expect(tidy.status, tidy.stderr).toBe(0);
    expect(tidy.stdout).toContain('uid=1001');
    expect(tidy.stdout).toContain('tidy=true');
    expect(modeOf(w, `${JOURNAL}/pending.md`) & 0o004).toBe(0o004);
    const read = run(
      [
        ...runArgs(),
        '--user',
        PLAYER,
        '-v',
        `${w.player}:/player`,
        '--entrypoint',
        'cat',
        KIT_IMAGE,
        `${JOURNAL}/pending.md`,
      ],
      { timeoutMs: RUN_MS },
    );
    expect(read.status, read.stderr).toBe(0);
    expect(read.stdout).toContain('old');
    expect(read.stdout).toContain('new');
  });
});
