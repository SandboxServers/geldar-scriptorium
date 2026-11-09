import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { GitIdentity } from '@geldar/scriptorium-path-rule';
import { noreplyIdentity } from '@geldar/scriptorium-path-rule';
import { gitEnv, NULL_DEVICE } from './run-git.ts';

// Test support: a throwaway work repo with a START commit shaped like a player's kit.
// Used by the verify tests and by SC-23b. Never imported by the shipped code.

export interface Who {
  author?: GitIdentity;
  committer?: GitIdentity;
}

export interface Fixture {
  dir: string; // the work repo
  out: string; // folder for bundle files
  start: string; // sha of the first commit
  playerId: string;
  noreply: GitIdentity;
  git(args: string[], who?: Who): string;
  write(rel: string, content: string): void;
  remove(rel: string): void;
  commitAll(message: string, who?: Who): string;
  stageEntry(mode: '100644' | '100755' | '120000' | '160000', rel: string, content?: string): void;
  commitStaged(message: string, who?: Who): string;
  bundle(refs: string[], name?: string): string;
  cleanup(): void;
}

const HOST: GitIdentity = { name: 'Host', email: 'host@example.test' };

function identityEnv(who: Who | undefined, fallback: GitIdentity): NodeJS.ProcessEnv {
  const author = who?.author ?? fallback;
  const committer = who?.committer ?? fallback;
  return {
    ...gitEnv(),
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: committer.name,
    GIT_COMMITTER_EMAIL: committer.email,
  };
}

export function makeFixture(playerId = 'mmpr-red'): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'verify-fixture-'));
  const dir = join(root, 'work');
  const out = join(root, 'out');
  mkdirSync(dir, { recursive: true });
  mkdirSync(out, { recursive: true });
  const noreply = noreplyIdentity(playerId);
  const defaultWho: Who = { author: noreply, committer: noreply };

  const exec = (args: string[], env: NodeJS.ProcessEnv, input?: string): string => {
    const fixed = ['-c', `core.hooksPath=${NULL_DEVICE}`];
    const result = spawnSync('git', [...fixed, ...args], {
      cwd: dir,
      env,
      encoding: 'utf8',
      input,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`fixture git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
  };

  const git = (args: string[], who?: Who): string => exec(args, identityEnv(who, noreply));

  const write = (rel: string, content: string): void => {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };

  const commitRaw = (message: string, who: Who | undefined): string => {
    git(['commit', '-q', '-m', message], who ?? defaultWho);
    return git(['rev-parse', 'HEAD']);
  };

  // The first commit: START, made by Host and holding the kit's files.
  git(['init', '-q', '-b', 'main', dir]);
  write('CLAUDE.md', '# Character\n');
  write('player.json', `${JSON.stringify({ player_id: playerId })}\n`);
  write('memory/identity.md', 'name: Test\n');
  write('memory/summary.md', 'summary\n');
  write('memory/goals.md', 'goals\n');
  write('memory/beliefs.md', 'beliefs\n');
  write('memory/people/.gitkeep', '');
  write('memory/journal/current.md', 'journal\n');
  git(['add', '-A']);
  const hostWho: Who = { author: HOST, committer: HOST };
  const start = commitRaw('start', hostWho);

  return {
    dir,
    out,
    start,
    playerId,
    noreply,
    git,
    write,
    remove(rel) {
      rmSync(join(dir, rel), { force: true });
    },
    commitAll(message, who) {
      git(['add', '-A']);
      return commitRaw(message, who);
    },
    stageEntry(mode, rel, content) {
      const sha =
        mode === '160000'
          ? start
          : exec(['hash-object', '-w', '--stdin'], identityEnv(undefined, noreply), content ?? '');
      git(['update-index', '--add', '--cacheinfo', `${mode},${sha},${rel}`]);
    },
    commitStaged(message, who) {
      return commitRaw(message, who);
    },
    bundle(refs, name = 'session.bundle') {
      const path = join(out, name);
      git(['bundle', 'create', path, ...refs]);
      return path;
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
