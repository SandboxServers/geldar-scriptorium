import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forbiddenMention, markedWords } from './tool-skill-scan.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../../template');
const hook = path.join(templateDir, '.claude/hooks/stop.sh');

// On Windows, pick Git Bash by path: a bare `bash` there can resolve to WSL's.
const gitBashPaths = [
  'C:/Program Files/Git/bin/bash.exe',
  'C:/Program Files (x86)/Git/bin/bash.exe',
];

function onPath(cmd: string): boolean {
  const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return result.error === undefined && result.status === 0;
}

function findBash(): string | undefined {
  if (process.platform === 'win32') return gitBashPaths.find((p) => existsSync(p));
  return onPath('bash') ? 'bash' : undefined;
}

const shell = findBash();
if (shell === undefined) {
  const message = 'stop-hook.test.ts: bash not found';
  // CI has bash, so a missing one there means a broken image: fail, don't skip.
  if (process.env.CI === 'true') throw new Error(message);
  console.warn(`${message}; suite skipped`);
}

// The exact text the hook prints for a first stop.
const expectedJson =
  '{"decision":"block","reason":"Before you stop: if what you did or found out changes what you want, rewrite memory/goals.md (ranked, with your reasons) and save it with commit_memory. If nothing changed, say \\"No change to my goals.\\" and stop."}';

describe.skipIf(shell === undefined)('stop hook', () => {
  let root: string;
  let project: string;
  let marker: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'stop-'));
    project = path.join(root, 'project');
    cpSync(templateDir, project, { recursive: true });
    marker = path.join(root, 'kit-marker');
    writeFileSync(marker, '');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // Runs the hook with the kit marker and the project in place; env overrides win.
  function run(input: string, env: NodeJS.ProcessEnv = {}, dir = project) {
    return spawnSync(shell as string, [hook], {
      input,
      encoding: 'utf8',
      env: {
        ...process.env,
        GELDAR_MODE: '',
        CLAUDE_PROJECT_DIR: dir,
        GELDAR_KIT_MARKER: marker,
        ...env,
      },
    });
  }

  it('asks once on a first stop, with the exact JSON', () => {
    const result = run(JSON.stringify({ session_id: 'abc', stop_hook_active: false }));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${expectedJson}\n`);
  });

  it('asks on empty stdin and on garbage stdin, and exits 0', () => {
    for (const input of ['', 'not json at all {{{']) {
      const result = run(input);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`${expectedJson}\n`);
    }
  });

  it.each([
    ['compact spacing', '{"stop_hook_active":true}'],
    ['spaced colon', '{"stop_hook_active" : true}'],
    ['spaces around the value', '{"stop_hook_active": true, "session_id": "x"}'],
  ])('lets the stop through when stop_hook_active is true (%s)', (_label, input) => {
    const result = run(input);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('asks when stop_hook_active is false', () => {
    const result = run('{"stop_hook_active": false}');
    expect(result.stdout).toBe(`${expectedJson}\n`);
  });

  it('prints nothing when memory/journal/pending.md exists (tidy session)', () => {
    writeFileSync(path.join(project, 'memory/journal/pending.md'), 'to tidy\n');
    const result = run('{}');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('prints nothing when GELDAR_MODE is setup', () => {
    const result = run('{}', { GELDAR_MODE: 'setup' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('still asks when GELDAR_MODE is play or empty', () => {
    expect(run('{}', { GELDAR_MODE: 'play' }).stdout).toBe(`${expectedJson}\n`);
    expect(run('{}', { GELDAR_MODE: '' }).stdout).toBe(`${expectedJson}\n`);
  });

  it('prints nothing and exits 0 without the kit marker', () => {
    const result = run('{}', { GELDAR_KIT_MARKER: path.join(root, 'absent') });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('prints nothing and exits 0 when CLAUDE_PROJECT_DIR is missing', () => {
    const result = run('{}', { CLAUDE_PROJECT_DIR: path.join(root, 'no-such-dir') });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('prints nothing and exits 0 when CLAUDE_PROJECT_DIR is unset', () => {
    const result = run('{}', { CLAUDE_PROJECT_DIR: undefined });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('writes nothing to the project', () => {
    const before = readFileSync(path.join(project, 'memory/goals.md'), 'utf8');
    run('{}');
    expect(readFileSync(path.join(project, 'memory/goals.md'), 'utf8')).toBe(before);
    expect(existsSync(path.join(project, 'memory/journal/pending.md'))).toBe(false);
  });

  it('the reason passes the player-text scans', () => {
    const parsed = JSON.parse(expectedJson) as { decision: string; reason: string };
    expect(parsed.decision).toBe('block');
    expect(markedWords(parsed.reason)).toEqual([]);
    expect(forbiddenMention.exec(parsed.reason)).toBeNull();
    expect(/^[\x20-\x7e]*$/.test(parsed.reason)).toBe(true);
  });

  it('is registered as a Stop hook with a timeout in settings.json', () => {
    const settings = JSON.parse(
      readFileSync(path.join(templateDir, '.claude/settings.json'), 'utf8'),
    ) as {
      hooks: Record<string, { matcher: string; hooks: { command: string; timeout?: number }[] }[]>;
    };
    const entry = settings.hooks.Stop?.[0];
    expect(entry?.matcher).toBe('');
    expect(entry?.hooks[0]?.command).toBe('"${CLAUDE_PROJECT_DIR}/.claude/hooks/stop.sh"');
    expect(entry?.hooks[0]?.timeout).toBeGreaterThan(0);
  });

  it('is executable like the other hooks', () => {
    if (process.platform === 'win32') return;
    expect(statSync(hook).mode & 0o111).not.toBe(0);
  });
});
