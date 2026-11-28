import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExecSpec } from './deps.ts';
import { makeFixture, onPoll } from './fixture.ts';

// The fixture's child environment, with the real PATH so that the real git can be found.
const ENV = { PATH: process.env.PATH ?? '' };
const IDENT = ['-c', 'user.name=Test', '-c', 'user.email=test@example.test'];
/** The workspace player's name: the keeper's gate needs every new commit to carry it. */
const PLAYER = 'player-x';

interface Scene {
  origin: string;
  ws: string;
  base: string;
}

/** Runs git in a test repository (set-up only; the apply itself runs through the seam below). */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...IDENT, ...args], { cwd, encoding: 'utf8' }).trim();
}

/** Writes a file and commits it as the player `who` (author and committer), as the player's runs do. */
function playerCommit(
  cwd: string,
  file: string,
  text: string,
  message: string,
  who: string,
): string {
  mkdirSync(dirname(join(cwd, file)), { recursive: true });
  writeFileSync(join(cwd, file), text);
  git(cwd, 'add', '-A');
  const email = `${who}@users.noreply.github.com`;
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: who,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: who,
      GIT_COMMITTER_EMAIL: email,
    },
  });
  return git(cwd, 'rev-parse', 'HEAD');
}

/** Writes a file and commits it; returns the new HEAD. */
function commit(cwd: string, file: string, text: string, message: string): string {
  mkdirSync(dirname(join(cwd, file)), { recursive: true });
  writeFileSync(join(cwd, file), text);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

/** A bare-ish upstream with one commit, and the player's workspace cloned from it at that commit. */
function scene(root: string): Scene {
  const origin = join(root, 'origin');
  mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  git(origin, 'config', 'user.name', 'Test');
  git(origin, 'config', 'user.email', 'test@example.test');
  // Line endings are fixed here: a machine-wide autocrlf would check the clone out as CRLF, and the
  // apply (which ignores global config) would then see every file as changed.
  git(origin, 'config', 'core.autocrlf', 'false');
  const base = commit(origin, 'journal.md', 'day one\n', 'base');
  git(root, '-c', 'core.autocrlf=false', 'clone', '-q', origin, 'ws');
  const ws = join(root, 'ws');
  git(ws, 'config', 'user.name', 'Test');
  git(ws, 'config', 'user.email', 'test@example.test');
  git(ws, 'config', 'core.autocrlf', 'false');
  return { origin, ws, base };
}

/** The keeper's bundle of base..origin main; returns the upstream head it carries. */
function bundle(keeperDir: string, s: Scene): string {
  const head = git(s.origin, 'rev-parse', 'HEAD');
  git(s.origin, 'bundle', 'create', join(keeperDir, 'upstream.bundle'), 'main', `^${s.base}`);
  return head;
}

/** The keeper's manifest naming the bundled head and the base it is cut from. */
function writeManifest(keeperDir: string, head: string, base: string): void {
  const body = { head, base, commits: 1, created_utc: '2026-01-10T23:00:00Z' };
  writeFileSync(join(keeperDir, 'upstream.json'), JSON.stringify(body));
}

/** Bundle and manifest together, as the keeper leaves them. */
function publish(keeperDir: string, s: Scene): string {
  const head = bundle(keeperDir, s);
  writeManifest(keeperDir, head, s.base);
  return head;
}

/** Runs the git calls for real (no setpriv here: the test user is the only user). */
function realGit(spec: ExecSpec): Promise<number> {
  return new Promise((resolve) => {
    const out = spec.stdoutPath === undefined ? 'ignore' : openSync(spec.stdoutPath, 'w');
    const err = spec.stderrPath === undefined ? 'ignore' : openSync(spec.stderrPath, 'w');
    const child = spawn('git', spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['ignore', out, err],
    });
    child.once('error', () => resolve(1));
    child.once('close', (code) => {
      if (typeof out === 'number') closeSync(out);
      if (typeof err === 'number') closeSync(err);
      resolve(code ?? 1);
    });
  });
}

/** Sends the git calls of a fixture through real git, still recording every spec in order. */
function withRealGit(f: ReturnType<typeof makeFixture>): void {
  const fake = f.deps.exec;
  f.deps.exec = async (spec) => {
    if (spec.file !== 'git') return fake(spec);
    await fake(spec);
    return realGit(spec);
  };
}

/**
 * Makes the first `times` rebases refuse: each writes `text` to its stderr file and exits 1 without
 * running git. Every rebase is noted in `events`, in order, with the sleeps (see recordSleeps).
 */
function failRebase(
  f: ReturnType<typeof makeFixture>,
  times: number,
  text: string,
  events: string[],
): void {
  const real = f.deps.exec;
  let refusals = 0;
  f.deps.exec = async (spec) => {
    const rebase =
      spec.file === 'git' && spec.args.includes('rebase') && !spec.args.includes('--abort');
    if (!rebase) return real(spec);
    events.push('rebase');
    if (refusals >= times) return real(spec);
    refusals++;
    f.specs.push(spec);
    writeFileSync(spec.stderrPath ?? '', text);
    return 1;
  };
}

/** Notes each sleep of the fixture in `events`, as `sleep <seconds>`. */
function recordSleeps(f: ReturnType<typeof makeFixture>, events: string[]): void {
  const real = f.deps.sleep;
  f.deps.sleep = async (seconds, wake) => {
    events.push(`sleep ${seconds}`);
    return real(seconds, wake);
  };
}

const gitSpecs = (specs: ExecSpec[]) => specs.filter((s) => s.file === 'git');
const sub = (specs: ExecSpec[], word: string) =>
  gitSpecs(specs).filter((s) => s.args.includes(word));
const at = (specs: ExecSpec[], name: string) =>
  specs.findIndex((s) => s.file === 'sh' && s.stdoutPath?.endsWith(name));

describe('applying upstream between runs', { timeout: 60_000 }, () => {
  it('fast-forwards between runs and never during one', async () => {
    // The keeper's manifest appears during run 1: the apply must wait for run 2.
    const f = makeFixture(
      { stopAt: 2, during: () => writeManifest(f.keeperDir, newHead, s.base) },
      {},
      ENV,
    );
    const s = scene(f.root);
    commit(s.origin, 'template.md', 'new template\n', 'template change');
    const newHead = git(s.origin, 'rev-parse', 'HEAD');
    bundle(f.keeperDir, s);
    withRealGit(f);
    expect(await f.supervisor.run()).toBe(0);
    const [r1, r2] = [at(f.specs, 'session-1.jsonl'), at(f.specs, 'session-2.jsonl')];
    const fetches = sub(f.specs, 'fetch');
    expect(fetches).toHaveLength(1);
    const idx = f.specs.indexOf(fetches[0] as ExecSpec);
    // The save that follows run 1 marks its end: the apply must come after it, before run 2.
    const saved1 = f.specs.findIndex((s) => s.file === 'geldar-git');
    expect(idx).toBeGreaterThan(saved1);
    expect(saved1).toBeGreaterThan(r1);
    expect(idx).toBeLessThan(r2);
    expect(git(s.ws, 'rev-parse', 'HEAD')).toBe(newHead);
    expect(f.read('status.json')).toContain(`"upstream_head":"${newHead}"`);
    expect(f.read('status.json')).toContain('"upstream_result":"applied"');
  });

  it('defers while the workspace has uncommitted changes', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    const s = scene(f.root);
    commit(s.origin, 'template.md', 'new template\n', 'template change');
    const head = publish(f.keeperDir, s);
    writeFileSync(join(s.ws, 'scratch.txt'), 'unsaved\n');
    withRealGit(f);
    expect(await f.supervisor.run()).toBe(0);
    expect(sub(f.specs, 'fetch')).toHaveLength(0);
    expect(git(s.ws, 'rev-parse', 'HEAD')).toBe(s.base);
    expect(head).not.toBe(s.base);
    expect(f.read('supervisor.log')).toContain('upstream deferred');
    expect(f.has('session-1.jsonl')).toBe(true);
  });

  it('rebases local unpushed commits on top of the upstream head', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    const s = scene(f.root);
    const memory = playerCommit(s.ws, 'memory/2026-01-10.md', 'a note\n', 'memory: a note', PLAYER);
    const head = commit(s.origin, 'template.md', 'new template\n', 'template change');
    publish(f.keeperDir, s);
    withRealGit(f);
    expect(await f.supervisor.run()).toBe(0);
    expect(git(s.ws, 'rev-parse', 'HEAD^')).toBe(head);
    expect(git(s.ws, 'log', '-1', '--format=%s')).toBe('memory: a note');
    expect(git(s.ws, 'rev-parse', 'HEAD')).not.toBe(memory);
    expect(existsSync(join(s.ws, 'template.md'))).toBe(true);
    expect(f.read('status.json')).toContain('"upstream_result":"applied"');
  });

  it('keeps the player as author and committer of a rebased commit, with no global git config', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    const s = scene(f.root);
    playerCommit(s.ws, 'memory/2026-01-10.md', 'a note\n', 'memory: a note', PLAYER);
    commit(s.origin, 'template.md', 'new template\n', 'template change');
    publish(f.keeperDir, s);
    withRealGit(f);
    expect(await f.supervisor.run()).toBe(0);
    // The rebase's committer comes from the player too, not from the hardened apply's empty config.
    const ident = git(s.ws, 'log', '-1', '--format=%an <%ae>|%cn <%ce>');
    expect(ident).toBe(
      `${PLAYER} <${PLAYER}@users.noreply.github.com>|${PLAYER} <${PLAYER}@users.noreply.github.com>`,
    );
    expect(f.read('status.json')).toContain('"upstream_result":"applied"');
  });

  it('refuses a rebase when the workspace HEAD is not a player identity', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    const s = scene(f.root);
    const local = commit(s.ws, 'memory/2026-01-10.md', 'a note\n', 'memory: a note');
    commit(s.origin, 'template.md', 'new template\n', 'template change');
    publish(f.keeperDir, s);
    withRealGit(f);
    expect(await f.supervisor.run()).toBe(0);
    expect(git(s.ws, 'rev-parse', 'HEAD')).toBe(local);
    expect(f.read('STOP')).toBe('auto: upstream sync: identity\n');
    expect(f.said.join('\n')).toContain('stopped itself: upstream sync: identity');
    expect(f.read('status.json')).toContain('"upstream_result":"failed: identity"');
  });

  it('aborts a conflicting change, restores the old HEAD and writes the auto STOP', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    const s = scene(f.root);
    const local = playerCommit(s.ws, 'journal.md', 'my edit\n', 'memory: local', PLAYER);
    commit(s.origin, 'journal.md', 'their edit\n', 'upstream edit');
    publish(f.keeperDir, s);
    withRealGit(f);
    expect(await f.supervisor.run()).toBe(0);
    expect(git(s.ws, 'rev-parse', 'HEAD')).toBe(local);
    expect(git(s.ws, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(s.ws, '.git', 'rebase-merge'))).toBe(false);
    expect(f.read('STOP')).toBe('auto: upstream sync: rebase\n');
    expect(f.said.join('\n')).toContain('stopped itself: upstream sync: rebase');
    expect(f.has('session-1.jsonl')).toBe(false);
    expect(f.read('status.json')).toContain('"upstream_result":"failed: rebase"');
  });

  it('refuses a malformed manifest with the auto STOP and runs nothing', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    scene(f.root);
    writeFileSync(join(f.keeperDir, 'upstream.json'), '{"head":"not-a-sha"}');
    withRealGit(f);
    expect(await f.supervisor.run()).toBe(0);
    expect(f.read('STOP')).toBe('auto: upstream sync: manifest\n');
    expect(f.has('session-1.jsonl')).toBe(false);
  });

  it('runs no hook and takes no config from the upstream or the workspace', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    const s = scene(f.root);
    const marker = join(f.root, 'pwned.txt').replace(/\\/g, '/');
    const script = `#!/bin/sh\necho ran > "${marker}"\n`;
    // A hook tracked in the bundle, a planted .git/hooks hook, and a planted core.hooksPath.
    const planted = join(f.root, 'planted-hooks');
    mkdirSync(planted);
    writeFileSync(join(planted, 'post-merge'), script);
    chmodSync(join(planted, 'post-merge'), 0o755);
    writeFileSync(join(s.ws, '.git', 'hooks', 'post-merge'), script);
    chmodSync(join(s.ws, '.git', 'hooks', 'post-merge'), 0o755);
    git(s.ws, 'config', 'core.hooksPath', planted);
    const head = commit(s.origin, '.githooks/post-merge', script, 'hook in the bundle');
    publish(f.keeperDir, s);
    withRealGit(f);
    expect(await f.supervisor.run()).toBe(0);
    expect(existsSync(join(f.root, 'pwned.txt'))).toBe(false);
    expect(git(s.ws, 'rev-parse', 'HEAD')).toBe(head);
    const fetch = sub(f.specs, 'fetch')[0];
    expect(fetch?.args).toEqual(
      expect.arrayContaining([
        `core.hooksPath=${join(f.stateDir, 'no-hooks')}`,
        'core.fsmonitor=false',
        'protocol.file.allow=user',
      ]),
    );
    expect(fetch?.env).toMatchObject({ GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
    expect(fetch?.uid).toBe(f.settings.playerUid);
  });

  it('does nothing on a repeated sync with no new manifest', async () => {
    const f = makeFixture({ stopAt: 2 }, {}, ENV);
    const s = scene(f.root);
    commit(s.origin, 'template.md', 'new template\n', 'template change');
    const head = publish(f.keeperDir, s);
    withRealGit(f);
    expect(await f.supervisor.run()).toBe(0);
    expect(sub(f.specs, 'fetch')).toHaveLength(1);
    expect(sub(f.specs, 'merge')).toHaveLength(1);
    expect(git(s.ws, 'rev-parse', 'HEAD')).toBe(head);
    expect(f.read('status.json')).toContain('"upstream_result":"none"');
    expect(f.read('status.json')).toContain(`"upstream_head":"${head}"`);
  });

  it('idles on a refused manifest STOP instead of exiting, with the heartbeat going on', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    scene(f.root);
    writeFileSync(join(f.keeperDir, 'upstream.json'), '{"head":"not-a-sha"}');
    let polls = 0;
    onPoll(f, (poll) => {
      polls = poll;
      for (const beat of f.beats) beat();
      if (poll === 3) f.supervisor.requestStop();
    });
    withRealGit(f);
    expect(await f.supervisor.run()).toBe(0);
    expect(polls).toBe(3);
    expect(f.runs()).toHaveLength(0);
    expect(f.read('status.json')).toMatch(/"state":"stopped"/);
    expect(f.read('status.json')).toContain('"stop_reason":"auto: upstream sync: manifest"');
  });

  it('fetches from a copy under the temporary folder, never the keeper state, and removes the copy', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    const s = scene(f.root);
    commit(s.origin, 'template.md', 'new template\n', 'template change');
    const head = publish(f.keeperDir, s);
    withRealGit(f);
    expect(await f.supervisor.run()).toBe(0);
    const copy = sub(f.specs, 'fetch')[0]?.args.find((a) => a.endsWith('upstream.bundle'));
    expect(copy).toBeDefined();
    expect(copy?.startsWith(tmpdir())).toBe(true);
    expect(copy?.startsWith(f.keeperDir)).toBe(false);
    expect(existsSync(copy as string)).toBe(false);
    expect(existsSync(dirname(copy as string))).toBe(false);
    expect(git(s.ws, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('removes the copy folder after a failed fetch too', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    const s = scene(f.root);
    commit(s.origin, 'template.md', 'new template\n', 'template change');
    bundle(f.keeperDir, s);
    writeManifest(f.keeperDir, '1'.repeat(40), s.base);
    withRealGit(f);
    expect(await f.supervisor.run()).toBe(0);
    const copy = sub(f.specs, 'fetch')[0]?.args.find((a) => a.endsWith('upstream.bundle'));
    expect(copy).toBeDefined();
    expect(existsSync(copy as string)).toBe(false);
    expect(existsSync(dirname(copy as string))).toBe(false);
    expect(f.read('STOP')).toBe('auto: upstream sync: fetch\n');
    expect(f.read('status.json')).toContain('"upstream_result":"failed: fetch"');
  });

  it('refuses a bundle that is a symlink, with the code bundle, and fetches nothing', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    const s = scene(f.root);
    commit(s.origin, 'template.md', 'new template\n', 'template change');
    const head = bundle(f.root, s);
    writeManifest(f.keeperDir, head, s.base);
    try {
      symlinkSync(join(f.root, 'upstream.bundle'), join(f.keeperDir, 'upstream.bundle'));
    } catch {
      console.info('symlinks are not available here: the symlink refusal is not tested');
      return;
    }
    withRealGit(f);
    expect(await f.supervisor.run()).toBe(0);
    expect(sub(f.specs, 'fetch')).toHaveLength(0);
    expect(git(s.ws, 'rev-parse', 'HEAD')).toBe(s.base);
    expect(f.read('STOP')).toBe('auto: upstream sync: bundle\n');
    expect(f.read('status.json')).toContain('"upstream_result":"failed: bundle"');
  });

  it('retries a refused rebase once: the second apply lands, with no STOP and git stderr logged', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    const s = scene(f.root);
    playerCommit(s.ws, 'memory/2026-01-10.md', 'a note\n', 'memory: a note', PLAYER);
    const head = commit(s.origin, 'template.md', 'new template\n', 'template change');
    publish(f.keeperDir, s);
    const events: string[] = [];
    withRealGit(f);
    failRebase(f, 1, 'fatal: simulated refusal\n', events);
    recordSleeps(f, events);
    expect(await f.supervisor.run()).toBe(0);
    expect(git(s.ws, 'rev-parse', 'HEAD^')).toBe(head);
    expect(f.read('status.json')).toContain('"upstream_result":"applied"');
    // The fixture's STOP is the only one: the upstream wrote none, so the run went ahead.
    expect(f.read('STOP')).toBe('x\n');
    expect(f.said.join('\n')).not.toContain('stopped itself');
    expect(f.read('supervisor.log')).toContain('upstream git: fatal: simulated refusal');
    expect(events.slice(0, 3)).toEqual(['rebase', 'sleep 20', 'rebase']);
  });

  it('writes the auto STOP only when the retry refuses too, naming the same step', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    const s = scene(f.root);
    const memory = playerCommit(s.ws, 'memory/2026-01-10.md', 'a note\n', 'memory: a note', PLAYER);
    commit(s.origin, 'template.md', 'new template\n', 'template change');
    publish(f.keeperDir, s);
    const events: string[] = [];
    withRealGit(f);
    failRebase(f, 2, '', events);
    recordSleeps(f, events);
    expect(await f.supervisor.run()).toBe(0);
    expect(git(s.ws, 'rev-parse', 'HEAD')).toBe(memory);
    expect(f.read('STOP')).toBe('auto: upstream sync: rebase\n');
    expect(f.said.join('\n')).toContain('stopped itself: upstream sync: rebase');
    expect(f.read('status.json')).toContain('"upstream_result":"failed: rebase"');
    expect(events.filter((e) => e === 'rebase')).toHaveLength(2);
    expect(events.filter((e) => e === 'sleep 20')).toHaveLength(1);
    expect(f.read('supervisor.log').match(/upstream git: \(no output\)/g)).toHaveLength(2);
  });

  it('logs git stderr as one line: control characters gone, newlines as spaces, capped at 1024', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    const s = scene(f.root);
    playerCommit(s.ws, 'memory/2026-01-10.md', 'a note\n', 'memory: a note', PLAYER);
    commit(s.origin, 'template.md', 'new template\n', 'template change');
    publish(f.keeperDir, s);
    withRealGit(f);
    failRebase(f, 2, `ab\x01cd\x1b\r\nef${'g'.repeat(2000)}`, []);
    expect(await f.supervisor.run()).toBe(0);
    const line = f
      .read('supervisor.log')
      .split('\n')
      .find((l) => l.includes('upstream git: '));
    expect(line?.slice(line.indexOf('upstream git: '))).toBe(
      `upstream git: abcd ef${'g'.repeat(1024 - 'abcd ef'.length)}`,
    );
  });

  it('defers when the workspace turns dirty during the wait, after one refused rebase', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    const s = scene(f.root);
    const memory = playerCommit(s.ws, 'memory/2026-01-10.md', 'a note\n', 'memory: a note', PLAYER);
    commit(s.origin, 'template.md', 'new template\n', 'template change');
    publish(f.keeperDir, s);
    const events: string[] = [];
    withRealGit(f);
    failRebase(f, 1, 'fatal: simulated refusal\n', events);
    const sleep = f.deps.sleep;
    f.deps.sleep = async (seconds, wake) => {
      events.push(`sleep ${seconds}`);
      if (seconds === 20) writeFileSync(join(s.ws, 'scratch.txt'), 'typed\n');
      return sleep(seconds, wake);
    };
    expect(await f.supervisor.run()).toBe(0);
    expect(git(s.ws, 'rev-parse', 'HEAD')).toBe(memory);
    expect(events.filter((e) => e === 'rebase')).toHaveLength(1);
    expect(f.read('status.json')).toContain('"upstream_result":"none"');
    expect(f.read('supervisor.log')).toContain(
      'upstream deferred: the workspace has uncommitted changes',
    );
    expect(f.said.join('\n')).not.toContain('stopped itself');
  });

  it('does not retry a refused identity', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    const s = scene(f.root);
    commit(s.ws, 'memory/2026-01-10.md', 'a note\n', 'memory: a note');
    commit(s.origin, 'template.md', 'new template\n', 'template change');
    publish(f.keeperDir, s);
    const events: string[] = [];
    withRealGit(f);
    recordSleeps(f, events);
    expect(await f.supervisor.run()).toBe(0);
    expect(f.read('STOP')).toBe('auto: upstream sync: identity\n');
    expect(events).not.toContain('rebase');
    expect(f.read('supervisor.log')).not.toContain('upstream git:');
    expect(events).not.toContain('sleep 20');
  });

  it('does not retry a refused base', async () => {
    const f = makeFixture({ stopAt: 1 }, {}, ENV);
    const s = scene(f.root);
    playerCommit(s.ws, 'memory/2026-01-10.md', 'a note\n', 'memory: a note', PLAYER);
    const head = commit(s.origin, 'template.md', 'new template\n', 'template change');
    publish(f.keeperDir, s);
    // A base the workspace HEAD does not contain: refused as `base`, before any apply step.
    writeManifest(f.keeperDir, head, head);
    const events: string[] = [];
    withRealGit(f);
    recordSleeps(f, events);
    expect(await f.supervisor.run()).toBe(0);
    expect(f.read('STOP')).toBe('auto: upstream sync: base\n');
    expect(events).not.toContain('rebase');
    expect(events).not.toContain('sleep 20');
  });
});
