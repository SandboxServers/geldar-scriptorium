import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../../template');
const scripts = ['session-start.sh', 'post-tool-use.sh', 'session-end.sh'];

// The hooks need bash and jq. CI has both; a bare local machine may not.
function onPath(cmd: string): boolean {
  const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return result.error === undefined && result.status === 0;
}
const missing = ['bash', 'jq'].filter((cmd) => !onPath(cmd));
if (missing.length > 0) {
  console.warn(`hooks.test.ts skipped: ${missing.join(' and ')} not on PATH`);
}

// Every file under dir, keyed by its path relative to dir.
function snapshot(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, snapshot(dir, child));
    else out[child] = readFileSync(path.join(dir, child), 'utf8');
  }
  return out;
}

describe.skipIf(missing.length > 0)('session hooks', () => {
  let root: string;
  let project: string;
  let marker: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'hooks-'));
    project = path.join(root, 'project');
    cpSync(templateDir, project, { recursive: true });
    marker = path.join(root, 'kit-marker');
    writeFileSync(marker, '');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function run(
    script: string,
    opts: { input?: string; env?: NodeJS.ProcessEnv; withMarker?: boolean } = {},
  ) {
    return spawnSync('bash', [path.join(project, '.claude/hooks', script)], {
      input: opts.input ?? '',
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: project,
        GELDAR_KIT_MARKER: opts.withMarker === false ? path.join(root, 'absent') : marker,
        ...opts.env,
      },
    });
  }

  it('does nothing without the kit marker', () => {
    const before = snapshot(project);
    const payload = JSON.stringify({ tool_name: 'mcp__geldar__say', tool_input: { text: 'hi' } });
    for (const script of scripts) {
      const result = run(script, { withMarker: false, input: payload });
      expect(result.status, script).toBe(0);
    }
    expect(snapshot(project)).toEqual(before);
  });

  it('appends one clean journal line for a tool call', () => {
    const journal = path.join(project, 'memory/journal/current.md');
    const before = readFileSync(journal, 'utf8');
    const payload = JSON.stringify({
      tool_name: 'mcp__geldar__say',
      tool_input: { text: '\u001b[31mhello\nthere' },
    });

    const result = run('post-tool-use.sh', { input: payload });

    expect(result.status).toBe(0);
    const appended = readFileSync(journal, 'utf8').slice(before.length);
    expect(appended.endsWith('\n')).toBe(true);
    expect(appended.slice(0, -1).includes('\n')).toBe(false);
    const line = appended.slice(0, -1);
    expect(line).toMatch(/^- \d{2}:\d{2} say: .*hello/);
    const hasControl = [...line].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);
    expect(hasControl).toBe(false);
  });

  it('greets the character by the name in player.json', () => {
    const playerPath = path.join(project, 'player.json');
    const player = JSON.parse(readFileSync(playerPath, 'utf8'));
    writeFileSync(playerPath, JSON.stringify({ ...player, name: 'Ilse Varn' }));

    const result = run('session-start.sh');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Ilse Varn');
    expect(result.stdout.trimEnd().split('\n').length).toBeLessThanOrEqual(12);
  });

  it('falls back to "you" when player.json has no name', () => {
    const result = run('session-start.sh');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('You are you.');
  });

  describe('session-end', () => {
    function stubGit(exitCode: number): { bin: string; log: string } {
      const bin = path.join(root, 'bin');
      mkdirSync(bin);
      const stub = path.join(bin, 'geldar-git');
      writeFileSync(
        stub,
        `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "$STUB_LOG"\nexit ${exitCode}\n`,
      );
      chmodSync(stub, 0o755);
      return { bin, log: path.join(root, 'args.log') };
    }

    it('hands unsaved memory to geldar-git with --if-changed', () => {
      const { bin, log } = stubGit(0);

      const result = run('session-end.sh', {
        env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, STUB_LOG: log },
      });

      expect(result.status).toBe(0);
      expect(readFileSync(log, 'utf8')).toContain('--if-changed');
    });

    it('exits 0 even when geldar-git fails', () => {
      const { bin, log } = stubGit(1);

      const result = run('session-end.sh', {
        env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, STUB_LOG: log },
      });

      expect(result.status).toBe(0);
    });
  });
});
