import { spawnSync } from 'node:child_process';
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
import { dirname, join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildKit, dockerPath, dockerReady, KIT_IMAGE, repoRoot, run } from './docker.ts';

const ready = dockerReady();
const linux = process.platform === 'linux';
// The workspace owner's uid on Linux (the CI runner's); the image default (1000) elsewhere.
const uid = linux ? (process.getuid?.() ?? 1000) : 1000;
const gid = linux ? (process.getgid?.() ?? 1000) : 1000;
// Hooks come from the template; GELDAR_HOOKS_DIR only lets a revert check point at a temp copy.
const hooksDir = process.env.GELDAR_HOOKS_DIR ?? resolve(repoRoot, 'template/.claude/hooks');
const RUN_MS = 60_000;

// Run as the workspace owner on Linux (git's safe.directory needs it); image default elsewhere.
const asOwner = linux ? ['--user', `${uid}:${gid}`, '-e', 'HOME=/tmp'] : [];

function kit(script: string, extra: string[] = [], input?: string) {
  const args = ['run', '--rm', ...(input === undefined ? [] : ['-i']), ...extra];
  return run([...args, KIT_IMAGE, 'sh', '-c', script], {
    timeoutMs: RUN_MS,
    ...(input === undefined ? {} : { input }),
  });
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

// Directories 0755 and files 0644 so the container can read them; a no-op on Windows.
function openForContainer(path: string): void {
  if (statSync(path).isDirectory()) {
    chmodSync(path, 0o755);
    for (const entry of readdirSync(path)) openForContainer(join(path, entry));
  } else {
    chmodSync(path, 0o644);
  }
}

// A temp workspace: player.json, memory/identity.md and one host commit on main.
function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-contract-'));
  mkdirSync(join(dir, 'memory'));
  writeFileSync(join(dir, 'player.json'), '{"player_id":"mmpr-red"}\n');
  writeFileSync(join(dir, 'memory', 'identity.md'), '# Identity\n');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', '-A']);
  git(dir, [
    '-c',
    'user.name=Host',
    '-c',
    'user.email=host@example.test',
    'commit',
    '-q',
    '-m',
    'init',
  ]);
  openForContainer(dir);
  return dir;
}

function removeWorkspace(dir: string): void {
  openForContainer(dir);
  rmSync(dir, { recursive: true, force: true });
}

// Runs one hook script with the workspace at /player and the hooks read-only at /hooks.
function hook(script: string, ws: string, extra: string[], input?: string) {
  return run(
    [
      'run',
      '--rm',
      ...(input === undefined ? [] : ['-i']),
      ...asOwner,
      '-e',
      'CLAUDE_PROJECT_DIR=/player',
      ...extra,
      '-v',
      `${dockerPath(ws)}:/player`,
      '-v',
      `${dockerPath(hooksDir)}:/hooks:ro`,
      KIT_IMAGE,
      'bash',
      `/hooks/${script}`,
    ],
    { timeoutMs: RUN_MS, ...(input === undefined ? {} : { input }) },
  );
}

describe.skipIf(!ready)('kit image contract', () => {
  beforeAll(buildKit, 900_000);

  it('marker: /etc/geldar-kit is root-owned and not writable by player', () => {
    const r = kit(
      'test -f /etc/geldar-kit && stat -c %U /etc/geldar-kit && test ! -w /etc/geldar-kit && echo unwritable',
    );
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual(['root', 'unwritable']);
  }, 120_000);

  it('settings are in place, byte-equal to the repo and unwritable', () => {
    const files = [
      ['/etc/geldar/settings/play.json', 'image/settings/play.json'],
      ['/etc/geldar/settings/setup.json', 'image/settings/setup.json'],
      ['/etc/claude-code/managed-settings.json', 'image/settings/managed.json'],
    ];
    for (const [inImage = '', rel = ''] of files) {
      const cat = kit(`cat ${inImage}`);
      expect(cat.status).toBe(0);
      expect(cat.stdout).toBe(readFileSync(resolve(repoRoot, rel), 'utf8'));
      const dir = dirname(inImage);
      const unwritable = kit(`test ! -w ${inImage} && test ! -w ${dir} && echo ok`);
      expect(unwritable.stdout.trim()).toBe('ok');
    }
  }, 120_000);

  describe('hooks act only with the marker', () => {
    it('session-start greets with the marker and prints nothing without it', () => {
      const ws = makeWorkspace();
      try {
        const on = hook('session-start.sh', ws, []);
        expect(on.status).toBe(0);
        expect(on.stdout.startsWith('You are ')).toBe(true);
        const off = hook('session-start.sh', ws, ['-e', 'GELDAR_KIT_MARKER=/nonexistent']);
        expect(off.status).toBe(0);
        expect(off.stdout).toBe('');
      } finally {
        removeWorkspace(ws);
      }
    }, 120_000);

    it('post-tool-use journals with the marker and writes nothing without it', () => {
      const payload = JSON.stringify({ tool_name: 'mcp__geldar__say', tool_input: { text: 'hi' } });
      const journal = (ws: string) => join(ws, 'memory', 'journal', 'current.md');
      const on = makeWorkspace();
      try {
        const r = hook('post-tool-use.sh', on, [], payload);
        expect(r.status).toBe(0);
        expect(existsSync(journal(on))).toBe(true);
        expect(readFileSync(journal(on), 'utf8')).toContain('say');
      } finally {
        removeWorkspace(on);
      }
      const off = makeWorkspace();
      try {
        const r = hook('post-tool-use.sh', off, ['-e', 'GELDAR_KIT_MARKER=/nonexistent'], payload);
        expect(r.stdout).toBe('');
        expect(r.stderr).toBe('');
        expect(existsSync(journal(off))).toBe(false);
        if (linux) {
          // Asserts the exit status, so a failing git cannot pass as empty output.
          const status = run(
            [
              'run',
              '--rm',
              ...asOwner,
              '-v',
              `${dockerPath(off)}:/player`,
              KIT_IMAGE,
              'git',
              '-C',
              '/player',
              'status',
              '--porcelain',
            ],
            { timeoutMs: RUN_MS },
          );
          expect(status.status).toBe(0);
          expect(status.stdout).toBe('');
        }
      } finally {
        removeWorkspace(off);
      }
    }, 120_000);
  });

  it('hooks never run as root: the hook shell runs as the given uid', () => {
    const ws = makeWorkspace();
    try {
      const r = run(
        [
          'run',
          '--rm',
          '--user',
          `${uid}:${gid}`,
          '-e',
          'HOME=/tmp',
          '-e',
          'CLAUDE_PROJECT_DIR=/player',
          '-v',
          `${dockerPath(ws)}:/player`,
          '-v',
          `${dockerPath(hooksDir)}:/hooks:ro`,
          KIT_IMAGE,
          'sh',
          '-c',
          'echo "uid=$(id -u)"; bash /hooks/session-start.sh',
        ],
        { timeoutMs: RUN_MS },
      );
      const [idLine = '', ...rest] = r.stdout.split('\n');
      expect(r.status).toBe(0);
      expect(idLine).toBe(`uid=${uid}`);
      expect(uid).not.toBe(0);
      expect(rest.join('\n').startsWith('You are ')).toBe(true);
    } finally {
      removeWorkspace(ws);
    }
  }, 120_000);

  it('the workspace is writable for the process uid', () => {
    const ws = makeWorkspace();
    try {
      const r = run(
        [
          'run',
          '--rm',
          ...asOwner,
          '-v',
          `${dockerPath(ws)}:/player`,
          KIT_IMAGE,
          'sh',
          '-c',
          'echo x >> /player/memory/identity.md',
        ],
        { timeoutMs: RUN_MS },
      );
      expect(r.status).toBe(0);
      expect(readFileSync(join(ws, 'memory', 'identity.md'), 'utf8')).toMatch(/x\n$/);
    } finally {
      removeWorkspace(ws);
    }
  }, 120_000);

  it('the player cannot become root', () => {
    expect(kit('command -v sudo').status).not.toBe(0);
    expect(kit('su -c id root </dev/null').status).not.toBe(0);
    const id = kit('id -u');
    expect(id.status).toBe(0);
    expect(Number(id.stdout.trim())).not.toBe(0);
  }, 120_000);

  it('no secrets are baked in and the CLI home and player home are clean', () => {
    const env = kit('env').stdout;
    for (const name of ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN']) {
      expect(env).not.toMatch(new RegExp(`^${name}=`, 'm'));
    }
    for (const prefix of ['AWS_', 'AZURE_']) {
      expect(env).not.toMatch(new RegExp(`^${prefix}`, 'm'));
    }
    const cliHome = kit('ls -A /cli-home');
    expect(cliHome.status).toBe(0);
    expect(cliHome.stdout.trim()).toBe('');
    const home = kit('ls -A /home/player');
    expect(home.status).toBe(0);
    const entries = home.stdout.split('\n');
    for (const name of ['.gitconfig', '.ssh', '.claude']) expect(entries).not.toContain(name);
  }, 120_000);

  describe.skipIf(!linux)('workspace uid (Linux only)', () => {
    it('git in /player works at the workspace owner uid and refuses another', () => {
      const ws = makeWorkspace();
      try {
        const same = run(
          [
            'run',
            '--rm',
            ...asOwner,
            '-v',
            `${dockerPath(ws)}:/player`,
            KIT_IMAGE,
            'git',
            '-C',
            '/player',
            'status',
            '--porcelain',
          ],
          { timeoutMs: RUN_MS },
        );
        expect(same.status).toBe(0);
        const other = run(
          [
            'run',
            '--rm',
            '--user',
            `${uid + 1}:${gid + 1}`,
            '-e',
            'HOME=/tmp',
            '-v',
            `${dockerPath(ws)}:/player`,
            KIT_IMAGE,
            'git',
            '-C',
            '/player',
            'status',
            '--porcelain',
          ],
          { timeoutMs: RUN_MS },
        );
        expect(other.status).not.toBe(0);
        expect(other.stderr).toContain('dubious ownership');
      } finally {
        removeWorkspace(ws);
      }
    }, 120_000);

    it('geldar-git commits a memory change as the workspace uid with the noreply identity', () => {
      const ws = makeWorkspace();
      try {
        writeFileSync(join(ws, 'memory', 'summary.md'), 'day 1\n');
        const r = run(
          [
            'run',
            '--rm',
            ...asOwner,
            '-v',
            `${dockerPath(ws)}:/player`,
            KIT_IMAGE,
            'geldar-git',
            'commit',
            '--root',
            '/player',
            '--message',
            'test',
          ],
          { timeoutMs: RUN_MS },
        );
        expect(r.status).toBe(0);
        expect(git(ws, ['log', '-1', '--format=%an']).trim()).toBe('player-mmpr-red');
      } finally {
        removeWorkspace(ws);
      }
    }, 120_000);
  });
});
