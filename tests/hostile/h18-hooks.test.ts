// H-18 (T-18): every hook script, run without the kit marker and with hostile
// stdin, exits 0 at once, writes nothing, prints nothing and creates no marker.
// With the marker present the wave 1 tests in tests/template/hooks.test.ts apply.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const hooksDir = path.resolve(here, '../../template/.claude/hooks');
// Listed from the directory so a new hook is covered.
const scripts = readdirSync(hooksDir).filter((f) => f.endsWith('.sh'));

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
const missing = [...(shell === undefined ? ['bash'] : []), ...(onPath('jq') ? [] : ['jq'])];
if (missing.length > 0) {
  const message = `h18-hooks.test.ts: ${missing.join(' and ')} not found`;
  // CI has both tools: a missing one there is a broken image, so fail (rule 14).
  if (process.env.CI === 'true') throw new Error(message);
  console.warn(`${message}; suite skipped`);
}

const validPayload = JSON.stringify({
  tool_name: 'Bash',
  tool_input: { command: 'echo $(touch pwned)' },
});

const payloads: Record<string, string> = {
  'a 10 MB line': `${'x'.repeat(10 * 1024 * 1024)}\n`,
  'invalid JSON': '{"tool_name": "mcp__geldar__say", "tool_input": {',
  'a valid tool call with a command substitution': validPayload,
};

function listAll(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
    out.push(entry.isDirectory() ? `${child}/` : child);
    if (entry.isDirectory()) out.push(...listAll(dir, child));
  }
  return out.sort();
}

describe.skipIf(missing.length > 0)('H-18 hooks without the kit marker', () => {
  let root: string;
  let project: string;
  let marker: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'h18-'));
    project = path.join(root, 'player');
    mkdirSync(path.join(project, 'memory'), { recursive: true });
    marker = path.join(root, 'no-such-marker');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('finds the three known hooks', () => {
    expect(scripts).toEqual(
      expect.arrayContaining(['post-tool-use.sh', 'session-end.sh', 'session-start.sh']),
    );
  });

  for (const script of scripts) {
    for (const [label, input] of Object.entries(payloads)) {
      it(`${script} exits 0 and writes nothing on ${label}`, { timeout: 60_000 }, () => {
        const before = listAll(root);
        const result = spawnSync(shell as string, [script], {
          cwd: hooksDir,
          input,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          env: { ...process.env, GELDAR_KIT_MARKER: marker, CLAUDE_PROJECT_DIR: project },
        });
        // The hook may exit before reading its stdin: a broken pipe is fine.
        if (result.error !== undefined) {
          expect((result.error as NodeJS.ErrnoException).code).toBe('EPIPE');
        }
        expect(result.status).toBe(0);
        expect(result.stdout).toBe('');
        expect(listAll(root)).toEqual(before);
        expect(existsSync(marker)).toBe(false);
        expect(existsSync(path.join(project, 'memory/journal'))).toBe(false);
        expect(existsSync(path.join(hooksDir, 'pwned'))).toBe(false);
        expect(existsSync(path.join(project, 'pwned'))).toBe(false);
      });
    }
  }

  it('control: post-tool-use.sh writes for the valid payload when the marker exists', () => {
    // Proves the valid payload is one the hook acts on, so the cases above can fail.
    const markerFile = path.join(root, 'marker');
    spawnSync(shell as string, ['-c', `: > "${markerFile.replaceAll('\\', '/')}"`]);
    const result = spawnSync(shell as string, ['post-tool-use.sh'], {
      cwd: hooksDir,
      input: validPayload,
      encoding: 'utf8',
      env: { ...process.env, GELDAR_KIT_MARKER: markerFile, CLAUDE_PROJECT_DIR: project },
    });
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(project, 'memory/journal/current.md'), 'utf8')).toContain(
      'Bash:',
    );
    expect(existsSync(path.join(project, 'pwned'))).toBe(false);
  });
});
