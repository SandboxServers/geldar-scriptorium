import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildKit, dockerPath, dockerReady, KIT_IMAGE, run } from './docker.ts';

// Pinned CLI behavior inside the kit image: no login and no model call. The API key is fake.
const ready = dockerReady();
const RUN_MS = 90_000;
const MANAGED = '/etc/claude-code/managed-settings.json';
const dirs: string[] = [];
let counter = 0;

type InitLine = {
  type?: string;
  subtype?: string;
  tools?: string[];
  mcp_servers?: { name: string; status: string }[];
};

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `geldar-cli-${prefix}-`));
  dirs.push(dir);
  chmodSync(dir, 0o755); // the player user in the container must read the mount
  return dir;
}

function tempFile(content: string, mode = 0o644): string {
  const file = join(tempDir('file'), 'settings.json');
  writeFileSync(file, content);
  chmodSync(file, mode);
  return file;
}

// A workspace the player would have: player.json and memory/.
function workspace(): string {
  const ws = tempDir('ws');
  mkdirSync(join(ws, 'memory'));
  writeFileSync(join(ws, 'player.json'), '{}\n');
  return ws;
}

// Starts the CLI in a container, reads its first stdout line, then kills the container.
// The CLI never exits without a network, so it is never waited for.
function initRun(
  args: string[],
  dockerArgs: string[] = [],
): Promise<{ init: InitLine; stderr: string }> {
  const name = `geldar-cli-${process.pid}-${counter++}`;
  return new Promise((resolveRun, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(
      'docker',
      [
        'run',
        '--rm',
        '--name',
        name,
        '-e',
        'HOME=/tmp',
        '-e',
        'CLAUDE_CONFIG_DIR=/tmp/cfg',
        '-e',
        'ANTHROPIC_API_KEY=sk-ant-fake',
        ...dockerArgs,
        KIT_IMAGE,
        'claude',
        '-p',
        'hi',
        '--output-format',
        'stream-json',
        '--verbose',
        '--max-turns',
        '1',
        ...args,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      spawnSync('docker', ['kill', name], { timeout: 30_000 });
      finish(() => reject(new Error(`no init line within ${RUN_MS} ms; stderr: ${stderr}`)));
    }, RUN_MS);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      const nl = stdout.indexOf('\n');
      if (nl === -1) return;
      spawnSync('docker', ['kill', name], { timeout: 30_000 });
      finish(() => {
        try {
          resolveRun({ init: JSON.parse(stdout.slice(0, nl)) as InitLine, stderr });
        } catch (err) {
          reject(err);
        }
      });
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('close', (code) => {
      finish(() => reject(new Error(`exited ${code} before the init line; stderr: ${stderr}`)));
    });
  });
}

function doctor(dockerArgs: string[] = []) {
  return run(
    ['run', '--rm', ...dockerArgs, KIT_IMAGE, 'sh', '-c', 'timeout 60 claude doctor 2>&1'],
    {
      timeoutMs: RUN_MS,
    },
  );
}

function git(root: string, args: string[]) {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=Host', '-c', 'user.email=host@example.test', ...args],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

// A player repo with memory/identity.md committed and then changed in the working tree.
function identityRepo(): string {
  const root = workspace();
  writeFileSync(join(root, 'player.json'), '{"player_id":"mmpr-red"}\n');
  writeFileSync(join(root, 'memory', 'identity.md'), 'v1\n');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'start']);
  writeFileSync(join(root, 'memory', 'identity.md'), 'v2\n');
  return root;
}

const BLOCKED = ['Bash', 'WebFetch', 'WebSearch'];
const ALLOWED = ['Read', 'Edit', 'Write'];

describe.skipIf(!ready)('pinned CLI behavior', () => {
  beforeAll(buildKit, 900_000);
  afterAll(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  }, 120_000);

  it('1. reads managed settings from /etc/claude-code/managed-settings.json', () => {
    const file = tempFile('{"model": 5}\n');
    const out = doctor(['-v', `${dockerPath(file)}:${MANAGED}:ro`]).stdout;
    // The pinned CLI prints `- <path> › model: Failed schema validation. This field was ignored.`
    expect(out).toMatch(/\/etc\/claude-code\/managed-settings\.json\s*[›(:]/);
    expect(out).toContain('Failed schema validation');
  }, 120_000);

  it('2. the shipped managed settings are valid for the pinned CLI', () => {
    const out = doctor().stdout;
    // The pinned CLI reports a bad value as `- <path> › <field>: Failed schema validation.`
    expect(out).not.toContain('Failed schema validation');
    expect(out).not.toContain('Invalid settings');
    expect(out).not.toContain('Managed settings contain invalid entries');
  }, 120_000);

  it('3. the shipped managed settings deny Bash, WebFetch and WebSearch only', async () => {
    const { init } = await initRun([], ['-v', `${dockerPath(workspace())}:/player`]);
    const tools = init.tools ?? [];
    for (const name of BLOCKED) expect(tools).not.toContain(name);
    for (const name of ALLOWED) expect(tools).toContain(name);
  }, 120_000);

  it('4. an empty managed file lifts the denies, so case 3 is not vacuous', async () => {
    const file = tempFile('{}\n');
    const { init } = await initRun(
      [],
      ['-v', `${dockerPath(workspace())}:/player`, '-v', `${dockerPath(file)}:${MANAGED}:ro`],
    );
    expect(init.tools ?? []).toContain('Bash');
  }, 120_000);

  it('5. play and setup settings are accepted and managed still wins', async () => {
    for (const layer of ['play', 'setup']) {
      const { init, stderr } = await initRun(
        ['--settings', `/etc/geldar/settings/${layer}.json`],
        ['-v', `${dockerPath(workspace())}:/player`],
      );
      expect(stderr).not.toMatch(/invalid/i);
      expect(init.tools ?? []).not.toContain('Bash');
    }
  }, 120_000);

  it('6. the real companions start under the CLI and report connected', async () => {
    const ws = workspace();
    writeFileSync(
      join(ws, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          geldar_memory: { command: 'geldar-memory', args: ['--root', '/player'] },
          geldar_git: { command: 'geldar-git', args: ['mcp', '--root', '/player'] },
        },
      }),
    );
    const { init } = await initRun(
      ['--mcp-config', '/player/mcp.json', '--strict-mcp-config'],
      ['-v', `${dockerPath(ws)}:/player`],
    );
    const servers = init.mcp_servers ?? [];
    for (const name of ['geldar_memory', 'geldar_git']) {
      expect(servers.find((s) => s.name === name)?.status).toBe('connected');
    }
    expect(init.tools).toEqual(
      expect.arrayContaining(['mcp__geldar_memory__recall', 'mcp__geldar_git__commit_memory']),
    );
  }, 120_000);

  it('7. GELDAR_MODE reaches stdio MCP servers only when it is set', async () => {
    const probe = tempDir('probe');
    chmodSync(probe, 0o777);
    const config = {
      mcpServers: {
        probe: { command: 'sh', args: ['-c', 'env > /tmp/probe/envdump; sleep 5'] },
      },
    };
    writeFileSync(join(probe, 'mcp.json'), JSON.stringify(config));
    const mounts = ['-v', `${dockerPath(probe)}:/tmp/probe`];
    const args = ['--mcp-config', '/tmp/probe/mcp.json', '--strict-mcp-config'];

    await initRun(args, [...mounts, '-e', 'GELDAR_MODE=setup']);
    const setupEnv = readFileSync(join(probe, 'envdump'), 'utf8');
    expect(setupEnv).toContain('GELDAR_MODE=setup');

    rmSync(join(probe, 'envdump'));
    await initRun(args, mounts);
    expect(existsSync(join(probe, 'envdump'))).toBe(true);
    expect(readFileSync(join(probe, 'envdump'), 'utf8')).not.toContain('GELDAR_MODE=');
  }, 120_000);

  it.skipIf(process.platform === 'win32')(
    '8. setup lets the identity commit through; play and unset refuse',
    () => {
      const uid = process.getuid?.() ?? 1000;
      const gid = process.getgid?.() ?? 1000;
      const commit = (mode: string[]) => {
        const root = identityRepo();
        const before = git(root, ['rev-parse', 'HEAD']).trim();
        const result = run(
          [
            'run',
            '--rm',
            '--user',
            `${uid}:${gid}`,
            '-e',
            'HOME=/tmp',
            ...mode,
            '-v',
            `${dockerPath(root)}:/player`,
            KIT_IMAGE,
            'geldar-git',
            'commit',
            '--root',
            '/player',
            '--message',
            'identity',
          ],
          { timeoutMs: RUN_MS },
        );
        return { root, before, result };
      };

      const setup = commit(['-e', 'GELDAR_MODE=setup']);
      expect(setup.result.status).toBe(0);
      expect(git(setup.root, ['show', '--stat', '--format=', 'HEAD'])).toContain(
        'memory/identity.md',
      );

      for (const mode of [['-e', 'GELDAR_MODE=play'], []]) {
        const refused = commit(mode);
        expect(refused.result.status).not.toBe(0);
        expect(refused.result.stderr.trim()).not.toBe('');
        expect(git(refused.root, ['rev-parse', 'HEAD']).trim()).toBe(refused.before);
      }
    },
    120_000,
  );
});
