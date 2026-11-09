import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitEnv } from '@geldar/scriptorium-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runScenario, type StepResult } from './run.ts';
import { parseScenario } from './scenario.ts';

const templateRoot = fileURLToPath(new URL('../../../template/', import.meta.url));
const memoryCli = fileURLToPath(new URL('../../memory/src/cli.ts', import.meta.url));
const gitCli = fileURLToPath(new URL('../../git/src/cli.ts', import.meta.url));
const birthFile = fileURLToPath(new URL('./scenarios/birth.jsonl', import.meta.url));
const reflectFile = fileURLToPath(new URL('./scenarios/reflect.jsonl', import.meta.url));
const TIMEOUT = 60_000;
const PLAYER_ID = 'mmpr-red';
const PLAYER = `player-${PLAYER_ID} <player-${PLAYER_ID}@users.noreply.github.com>`;

let root: string;

// Runs git against the player folder with the null global config (no host identity leaks in).
function git(args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, env: gitEnv(), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function lines(text: string): string[] {
  return text.split('\n').filter((line) => line !== '');
}

// The template, as a player folder: its own repo, with player_id set and a host start commit.
function makePlayerFolder(): string {
  cpSync(templateRoot, root, { recursive: true });
  const file = path.join(root, 'player.json');
  const player = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  writeFileSync(file, `${JSON.stringify({ ...player, player_id: PLAYER_ID })}\n`);
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git([
    '-c',
    'user.name=Host',
    '-c',
    'user.email=host@example.test',
    'commit',
    '-q',
    '-m',
    'start',
  ]);
  return git(['rev-parse', 'HEAD']).trim();
}

// Maps the template's command names to the workspace CLIs, with the /player root replaced.
function resolveCommand({ command, args }: { command: string; args: string[] }): {
  command: string;
  args: string[];
} {
  const script = command === 'geldar-memory' ? memoryCli : command === 'geldar-git' ? gitCli : '';
  if (script === '') throw new Error(`no CLI for ${command}`);
  return {
    command: process.execPath,
    args: [script, ...args.map((arg) => (arg === '/player' ? root : arg))],
  };
}

function failures(results: StepResult[], steps: number): string[] {
  if (results.length !== steps) return [`ran ${results.length} of ${steps} steps`];
  return results.filter((r) => !r.ok).map((r) => `step ${r.index}: ${r.failure ?? ''}`);
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'stub-birth-reflect-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a birth and a reflect', () => {
  it(
    'saves the birth and the day as two player-authored commits and leaves tampered files alone',
    async () => {
      const start = makePlayerFolder();

      const birthSteps = parseScenario(readFileSync(birthFile, 'utf8'));
      const birth = await runScenario({
        root,
        steps: birthSteps,
        env: { GELDAR_MODE: 'setup' },
        resolveCommand,
      });
      expect(failures(birth, birthSteps.length)).toEqual([]);

      // The reflect is a play session, so GELDAR_MODE is removed from the host environment.
      const reflectSteps = parseScenario(readFileSync(reflectFile, 'utf8'));
      const savedMode = process.env.GELDAR_MODE;
      delete process.env.GELDAR_MODE;
      let reflect: StepResult[];
      try {
        reflect = await runScenario({ root, steps: reflectSteps, env: {}, resolveCommand });
      } finally {
        if (savedMode !== undefined) process.env.GELDAR_MODE = savedMode;
      }
      expect(failures(reflect, reflectSteps.length)).toEqual([]);

      const range = `${start}..HEAD`;
      expect(lines(git(['log', range, '--format=%s']))).toEqual([
        'day 001: found the hive site',
        'birth: Wren',
      ]);
      expect(lines(git(['log', range, '--format=%an <%ae>|%cn <%ce>']))).toEqual([
        `${PLAYER}|${PLAYER}`,
        `${PLAYER}|${PLAYER}`,
      ]);

      const [reflectSha, birthSha] = lines(git(['log', range, '--format=%H']));
      expect(
        lines(git(['diff-tree', '--no-commit-id', '--name-only', '-r', birthSha ?? ''])),
      ).toEqual(['memory/goals.md', 'memory/identity.md', 'memory/summary.md']);
      expect(
        lines(git(['diff-tree', '--no-commit-id', '--name-only', '-r', reflectSha ?? ''])),
      ).toEqual(['memory/journal/day-001.md', 'memory/people/pike.md', 'memory/summary.md']);

      expect(lines(git(['status', '--porcelain']))).toEqual([
        ' M CLAUDE.md',
        ' M memory/identity.md',
      ]);
    },
    TIMEOUT,
  );
});
