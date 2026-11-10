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
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repoRoot } from './docker.ts';

// No Docker here: the kit entrypoint runs under sh with a temp directory for /cli-home and a fake
// base entrypoint on PATH. On Windows the shell is Git for Windows' bash, never WSL's.
const gitBashPaths = [
  'C:/Program Files/Git/bin/bash.exe',
  'C:/Program Files (x86)/Git/bin/bash.exe',
];
const shell =
  process.platform === 'win32'
    ? gitBashPaths.find((p) => existsSync(p))
    : spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0
      ? 'bash'
      : undefined;
if (shell === undefined) {
  const message = 'entrypoint.test.ts: bash not found';
  // CI has bash, so a missing one there means a broken runner: fail, don't skip.
  if (process.env.CI === 'true') throw new Error(message);
  console.warn(`${message}; suite skipped`);
}

const script = path.join(repoRoot, 'image', 'geldar-entrypoint.sh');
const win = process.platform === 'win32';
const toSlash = (p: string) => p.replace(/\\/g, '/');
const seededTrust = { projects: { '/player': { hasTrustDialogAccepted: true } } };

interface Fixture {
  root: string;
  cliHome: string;
  binDir: string;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'geldar-entry-'));
  const cliHome = path.join(root, 'cli-home');
  const binDir = path.join(root, 'bin');
  mkdirSync(cliHome);
  mkdirSync(binDir);
  // Stands in for the base image's docker-entrypoint.sh: it shows the arguments it was given.
  const base = path.join(binDir, 'docker-entrypoint.sh');
  writeFileSync(base, '#!/bin/sh\necho "base:$*"\n');
  chmodSync(base, 0o755);
  return { root, cliHome, binDir };
}

// Runs the kit entrypoint. GELDAR_MODE is set only when `mode` is given: the inherited
// environment never leaks one in.
function runEntrypoint(fx: Fixture, mode?: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GELDAR_')) env[key] = value;
  }
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = `${fx.binDir}${path.delimiter}${env[pathKey] ?? ''}`;
  env.GELDAR_CLI_HOME_DIR = toSlash(fx.cliHome);
  env.GELDAR_TRUST_PATH = '/player';
  if (mode !== undefined) env.GELDAR_MODE = mode;
  return spawnSync(shell ?? 'bash', [toSlash(script), 'node'], { env, encoding: 'utf8' });
}

describe.skipIf(shell === undefined)('kit entrypoint seeds the workspace trust', () => {
  let fx: Fixture;
  const config = () => path.join(fx.cliHome, '.claude.json');

  beforeEach(() => {
    fx = makeFixture();
  });
  afterEach(() => {
    rmSync(fx.root, { recursive: true, force: true });
  });

  it('creates the file with the trust key when it is absent, then starts the base entrypoint', () => {
    const r = runEntrypoint(fx, 'play');
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(config(), 'utf8'))).toEqual(seededTrust);
    if (!win) expect(statSync(config()).mode & 0o777).toBe(0o600);
    expect(r.stdout.trim()).toBe('base:node');
  });

  it('keeps every other key of a logged-in session', () => {
    const before = {
      numStartups: 7,
      oauthAccount: { emailAddress: 'invented@example.test', accountUuid: 'invented-uuid' },
      projects: {
        '/other': { allowedTools: ['Bash(git status)'] },
        '/player': { allowedTools: ['Read'] },
      },
    };
    writeFileSync(config(), JSON.stringify(before));
    const r = runEntrypoint(fx, 'setup');
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(config(), 'utf8'))).toEqual({
      numStartups: 7,
      oauthAccount: before.oauthAccount,
      projects: {
        '/other': { allowedTools: ['Bash(git status)'] },
        '/player': { allowedTools: ['Read'], hasTrustDialogAccepted: true },
      },
    });
  });

  it('leaves invalid JSON untouched, logs one line without its content, and still starts', () => {
    const junk = '{"oauthAccount": "invented-not-closed';
    writeFileSync(config(), junk);
    const r = runEntrypoint(fx, 'play');
    expect(r.status).toBe(0);
    expect(readFileSync(config(), 'utf8')).toBe(junk);
    expect(r.stderr.trim().split('\n')).toHaveLength(1);
    expect(r.stderr).not.toContain('invented');
    expect(r.stdout.trim()).toBe('base:node');
  });

  it('writes nothing when GELDAR_MODE is unset', () => {
    const r = runEntrypoint(fx);
    expect(r.status).toBe(0);
    expect(existsSync(config())).toBe(false);
    expect(readdirSync(fx.cliHome)).toEqual([]);
    expect(r.stdout.trim()).toBe('base:node');
  });

  it('a second run leaves the same bytes and no temp file', () => {
    expect(runEntrypoint(fx, 'play').status).toBe(0);
    const first = readFileSync(config(), 'utf8');
    const r = runEntrypoint(fx, 'play');
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(config(), 'utf8')).toBe(first);
    expect(readdirSync(fx.cliHome)).toEqual(['.claude.json']);
  });
});
