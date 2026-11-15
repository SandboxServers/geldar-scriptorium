// The two user ids of a live host, run for real in the kit image: the player is uid 1000, the
// supervisor is uid 1001, and the supervisor runs with umask 027 (set by the player entrypoint).
// Covers SC-184 (the journal directory mode, set by the entrypoint) and SC-185 (the pending.md mode,
// set by prepareTidy). Named volumes are prepared by a root container, so no host uid is needed.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildKit, dockerPath, dockerReady, KIT_IMAGE, run } from './docker.ts';

const READY = dockerReady();
const PLAYER = '1000:1000';
const SUPERVISOR = '1001:1001';
const RUN_MS = 60_000;
// The player service's hardening in image/compose/player.yml: cap_drop ALL, its six capabilities,
// no-new-privileges, a read-only root filesystem, init, and no network.
const COMPOSE_RUN = [
  '--init',
  '--network',
  'none',
  '--read-only',
  '--tmpfs',
  '/tmp:mode=1777',
  '--cap-drop',
  'ALL',
  '--cap-add',
  'CHOWN',
  '--cap-add',
  'FOWNER',
  '--cap-add',
  'FSETID',
  '--cap-add',
  'SETUID',
  '--cap-add',
  'SETGID',
  '--cap-add',
  'SETPCAP',
  '--security-opt',
  'no-new-privileges:true',
];
const ENTRYPOINT = '/usr/local/bin/geldar-player-entrypoint';
const JOURNAL = '/player/memory/journal';

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

// The four volumes the player service mounts, by their container paths.
interface Workspace {
  player: string;
  cli: string;
  state: string;
  keeper: string;
}

const volumes: string[] = [];
let hostDir = '';
let standIn = '';

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
    'run',
    '--rm',
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
    'run',
    '--rm',
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

// Runs the real player entrypoint as the compose service does: root, the compose caps, and the stand-in
// replacing geldar-supervisor.
function enter(w: Workspace) {
  return run(
    [
      'run',
      '--rm',
      ...COMPOSE_RUN,
      '--user',
      '0:0',
      '-e',
      'HOME=/tmp',
      '-e',
      'GELDAR_MODE=play',
      ...mounts(w),
      '-v',
      `${dockerPath(standIn)}:/usr/local/bin/geldar-supervisor:ro`,
      '--entrypoint',
      ENTRYPOINT,
      KIT_IMAGE,
    ],
    { timeoutMs: RUN_MS },
  );
}

// The pending.md step of prepareTidy, as a plain filesystem operation run as uid 1001 with umask 027:
// write a temp file with mode 0644, optionally chmod it (the explicit chmod that prepareTidy makes
// because the umask strips the mode), then rename it over pending.md. This covers the operation, not
// the supervisor: SC-185's own supervisor test is the revert guard for the code.
const PENDING_OP = [
  "const fs = require('fs');",
  "const d = '/player/memory/journal';",
  "const t = d + '/.pending.tmp-' + process.pid;",
  "fs.writeFileSync(t, 'combined\\n', { mode: 0o644 });",
  "if (process.env.CHMOD === '1') fs.chmodSync(t, 0o644);",
  "fs.renameSync(t, d + '/pending.md');",
].join(' ');

function pendingOp(w: Workspace, chmod: '0' | '1') {
  return run(
    [
      'run',
      '--rm',
      '--network',
      'none',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--user',
      SUPERVISOR,
      '-e',
      `CHMOD=${chmod}`,
      '-e',
      `OP=${PENDING_OP}`,
      '-v',
      `${w.player}:/player`,
      '--entrypoint',
      'sh',
      KIT_IMAGE,
      '-c',
      'umask 027; node -e "$OP"',
    ],
    { timeoutMs: RUN_MS },
  );
}

// A workspace as the tidy finds it: an existing pending.md owned by the player (mode 0600) and a
// journal directory the entrypoint has made writable (0777).
function pendingWorkspace(): Workspace {
  const w = newWorkspace();
  prepare(
    w,
    `mkdir -p ${JOURNAL} && printf 'old\\n' > ${JOURNAL}/pending.md && printf '# Journal\\n' > ${JOURNAL}/current.md && chown -R 1000:1000 /player && chmod 0777 ${JOURNAL} && chmod 0600 ${JOURNAL}/pending.md`,
  );
  return w;
}

beforeAll(() => {
  if (!READY) return;
  buildKit();
  hostDir = mkdtempSync(path.join(tmpdir(), 'geldar-two-uid-'));
  standIn = path.join(hostDir, 'geldar-supervisor');
  writeFileSync(standIn, STAND_IN, { mode: 0o755 });
});

afterEach(() => {
  for (const name of volumes.splice(0)) run(['volume', 'rm', '-f', name]);
});

afterAll(() => {
  if (hostDir !== '') rmSync(hostDir, { recursive: true, force: true });
});

describe.skipIf(!READY)('SC-184: the supervisor renames current.md under the real uids', () => {
  it('the entrypoint makes the journal directory writable, so uid 1001 can move current.md', () => {
    const w = newWorkspace();
    prepare(
      w,
      `mkdir -p ${JOURNAL} && printf '# Journal\\n' > ${JOURNAL}/current.md && chown -R 1000:1000 /player && chmod 0755 ${JOURNAL}`,
    );
    const r = enter(w);
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
    const r = enter(w);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('rename=EACCES');
    expect(modeOf(w, '/player/other')).toBe(0o755);
  });
});

describe.skipIf(!READY)('SC-185: pending.md is readable by the player after a tidy', () => {
  it('a pending.md written as uid 1001 with umask 027 and chmod 0644 is readable as uid 1000', () => {
    const w = pendingWorkspace();
    const write = pendingOp(w, '1');
    expect(write.status, write.stderr).toBe(0);
    expect(modeOf(w, `${JOURNAL}/pending.md`) & 0o044).not.toBe(0);
    const read = run(
      [
        'run',
        '--rm',
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
    expect(read.stdout).toContain('combined');
  });

  it('control: without the explicit chmod the umask leaves pending.md unreadable by uid 1000', () => {
    const w = pendingWorkspace();
    const write = pendingOp(w, '0');
    expect(write.status, write.stderr).toBe(0);
    // Mode 0640 owned by uid 1001: the group bit is set, but the player is not in that group.
    expect(modeOf(w, `${JOURNAL}/pending.md`) & 0o004).toBe(0);
    const read = run(
      [
        'run',
        '--rm',
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
    expect(read.status).not.toBe(0);
  });
});
