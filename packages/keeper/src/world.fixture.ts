import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { noreplyIdentity } from '@geldar/scriptorium-path-rule';
import type { KeeperConfig } from './config.ts';
import type { GitResult } from './git.ts';
import { hardenedEnv, runGit } from './git.ts';
import type { KeeperDeps } from './keeper.ts';
import { directTransport } from './transport.ts';

// Test support: a workspace repo, a bare remote and a keeper configuration around them.
// Never imported by the shipped code.

export const PLAYER_ID = 'mmpr-red';
export const KEY_MARKER = 'DEPLOY-KEY-MARKER-0123456789';

export interface Call {
  args: readonly string[];
  env: NodeJS.ProcessEnv;
}

export interface World {
  root: string;
  ws: string;
  remote: string;
  sentinel: string;
  cfg: KeeperConfig;
  deps: KeeperDeps;
  calls: Call[];
  logs: string[];
  /** Number of recorded `push` invocations. */
  pushes(): number;
  write(rel: string, content: string): void;
  commit(message: string): string;
  /** Commits a tree entry of the given mode that has no file in the work tree. */
  stage(mode: '120000' | '160000', rel: string): void;
  git(cwd: string, args: string[]): string;
  remoteHead(): string;
  /** Pushes a commit to the remote from a second clone, as another writer would. */
  remoteMoves(): string;
  /**
   * Pushes an upstream change from a second clone. `change` edits that clone with the given git
   * helper. With `rewrite`, the remote's branch is replaced by a root commit (not a fast-forward).
   */
  remoteChange(change: RemoteChange, rewrite?: boolean): string;
  cleanup(): void;
}

export type RemoteChange = (dir: string, git: (args: string[]) => string) => void;

const NOREPLY = noreplyIdentity(PLAYER_ID);

function identity(): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: NOREPLY.name,
    GIT_AUTHOR_EMAIL: NOREPLY.email,
    GIT_COMMITTER_NAME: NOREPLY.name,
    GIT_COMMITTER_EMAIL: NOREPLY.email,
  };
}

export function makeWorld(): World {
  const root = mkdtempSync(join(tmpdir(), 'keeper-world-'));
  const ws = join(root, 'ws');
  const remote = join(root, 'remote.git');
  const hooksDir = join(root, 'empty-hooks');
  const keyFile = join(root, 'key');
  for (const dir of [ws, hooksDir, join(root, 'sup')]) mkdirSync(dir, { recursive: true });
  writeFileSync(keyFile, `${KEY_MARKER}\n`);

  const git = (cwd: string, args: string[]): string => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=NUL', ...args], {
      cwd,
      env: hardenedEnv(identity()),
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (rel: string, content: string): void => {
    const file = join(ws, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };

  git(root, ['init', '-q', '-b', 'main', ws]);
  write('CLAUDE.md', '# Character\n');
  write('player.json', `${JSON.stringify({ player_id: PLAYER_ID })}\n`);
  write('memory/identity.md', 'name: Test\n');
  write('memory/summary.md', 'summary\n');
  write('memory/journal/current.md', 'journal\n');
  git(ws, ['add', '-A']);
  git(ws, ['-c', 'user.useConfigOnly=false', 'commit', '-q', '-m', 'start']);
  git(root, ['init', '-q', '--bare', '-b', 'main', remote]);
  git(ws, ['push', '-q', remote, 'main']);

  const calls: Call[] = [];
  const logs: string[] = [];
  const recording = (cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): GitResult => {
    calls.push({ args, env });
    return runGit(cwd, args, env);
  };
  const sentinel = join(root, 'sentinel');
  const cfg: KeeperConfig = {
    remote,
    key: keyFile,
    intervalSeconds: 600,
    retrySeconds: 60,
    fetchFailLimit: 10,
    workspace: ws,
    clone: join(root, 'clone'),
    state: join(root, 'state'),
    supervisorState: join(root, 'sup'),
    branch: 'main',
    playerId: PLAYER_ID,
    proxy: 'proxy-keeper:3128',
    knownHosts: join(root, 'known_hosts'),
    hooksDir,
  };
  const deps: KeeperDeps = {
    git: recording,
    transport: directTransport(remote),
    log: (line) => logs.push(line),
    now: () => new Date('2026-01-02T03:04:05Z'),
  };

  return {
    root,
    ws,
    remote,
    sentinel,
    cfg,
    deps,
    calls,
    logs,
    pushes: () => calls.filter((call) => call.args.includes('push')).length,
    write,
    commit(message) {
      git(ws, ['add', '-A']);
      git(ws, ['commit', '-q', '-m', message]);
      return git(ws, ['rev-parse', 'HEAD']);
    },
    stage(mode, rel) {
      const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: ws,
        env: hardenedEnv(),
        input: 'target\n',
        encoding: 'utf8',
      }).stdout.trim();
      const sha = mode === '160000' ? git(ws, ['rev-parse', 'HEAD']) : blob;
      git(ws, ['update-index', '--add', '--cacheinfo', `${mode},${sha},${rel}`]);
      git(ws, ['commit', '-q', '-m', 'bad entry']);
    },
    git,
    remoteHead: () => git(remote, ['rev-parse', 'refs/heads/main']),
    remoteMoves() {
      const other = join(root, 'other');
      git(root, ['clone', '-q', remote, other]);
      writeFileSync(join(other, 'memory', 'owner-note.md'), 'owner\n');
      git(other, ['add', '-A']);
      git(other, ['commit', '-q', '-m', 'owner edit']);
      git(other, ['push', '-q', 'origin', 'main']);
      const head = git(other, ['rev-parse', 'HEAD']);
      rmSync(other, { recursive: true, force: true });
      return head;
    },
    remoteChange(change, rewrite = false) {
      const other = join(root, 'other');
      git(root, ['clone', '-q', remote, other]);
      if (rewrite) git(other, ['checkout', '-q', '--orphan', 'rewritten']);
      change(other, (args) => git(other, args));
      // --no-all: a path that only update-index staged (a symlink, a gitlink) has no file on disk,
      // and a plain add -A would drop it from the index.
      git(other, ['add', '--no-all', '.']);
      git(other, ['commit', '-q', '--allow-empty', '-m', rewrite ? 'rewrite' : 'upstream']);
      git(other, ['push', '-q', ...(rewrite ? ['-f'] : []), 'origin', 'HEAD:refs/heads/main']);
      const head = git(other, ['rev-parse', 'HEAD']);
      rmSync(other, { recursive: true, force: true });
      return head;
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// Makes an executable hook that records that it ran.
export function plantHook(dir: string, name: string, sentinel: string): void {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\necho ${name} >> '${sentinel.replaceAll('\\', '/')}'\nexit 0\n`);
  chmodSync(file, 0o755);
}
