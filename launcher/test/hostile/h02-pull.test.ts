import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  forGroup,
  git,
  type Launcher,
  makePlayer,
  makeWorld,
  type Player,
  run,
  type World,
} from '../harness.ts';
import { timingIt } from '../timing.ts';
import {
  expectHostUnchanged,
  expectNoDockerCall,
  expectRefusal,
  type HostSnapshot,
  snapshotHost,
} from './world.ts';

// SC-60c, H-02 (T-02): the pull is fast-forward only; what it brings in is read after the pull.
const T = 120_000;
const envOf = (l: Launcher, w: World, extra: Record<string, string> = {}) => ({
  ...(l.name === 'bash' ? w.env : w.envPwsh),
  ...extra,
});
const gitEnv = (w: World) => ({ GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') });
const prep = (l: Launcher, w: World, extra: Record<string, string> = {}) =>
  run(l, ['__prepare', 'abc', 'play'], { env: envOf(l, w, extra), timeoutMs: T });

function commit(w: World, dir: string, file: string, body: string, push: boolean) {
  writeFileSync(join(dir, file), body);
  git(dir, ['add', '-A'], gitEnv(w));
  git(dir, ['commit', '-q', '-m', `edit ${file}`], gitEnv(w));
  if (push) git(dir, ['push', '-q', 'origin', 'main'], gitEnv(w));
}

function other(w: World, p: Player): string {
  const dir = join(w.root, 'other');
  git(w.root, ['clone', '-q', p.origin, dir], gitEnv(w));
  return dir;
}

// The pull's fetch moves the remote-tracking ref: that is not a change to the player's branch.
const sameHost = (a: HostSnapshot, b: HostSnapshot) =>
  expectHostUnchanged({ ...a, cloneRefs: '' }, { ...b, cloneRefs: '' });

describe.each(forGroup('hostile'))('H-02 pull ($name)', (launcher) => {
  it('a diverged origin gives pull_failed and changes nothing', { timeout: T }, () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'abc' });
    commit(w, other(w, p), 'remote.md', 'r\n', true);
    commit(w, p.clone, 'local.md', 'l\n', false);
    const before = snapshotHost(w, p);
    const r = prep(launcher, w);
    expectRefusal(r, 'pull_failed', { status: 1 });
    expectNoDockerCall(w);
    sameHost(before, snapshotHost(w, p));
  });

  it('origin rewritten to an older commit, local ahead: starts from local HEAD', {
    timeout: T,
  }, () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'abc' });
    const older = git(p.clone, ['rev-parse', 'HEAD~1']);
    commit(w, p.clone, 'local.md', 'l\n', false);
    git(p.origin, ['update-ref', 'refs/heads/main', older]);
    const head = git(p.clone, ['rev-parse', 'HEAD']);
    const r = prep(launcher, w);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(p.stateDir, 'start'), 'utf8').trim()).toBe(head);
    expect(git(p.clone, ['rev-parse', 'HEAD'])).toBe(head);
    expect(git(p.clone, ['status', '--porcelain', '--untracked-files=all'])).toBe('');
    const inits = w
      .calls()
      .filter((c) => c[0] === 'run' && c.includes('geldar.role=workspace-init'));
    expect(inits.length).toBeGreaterThan(0);
  });

  it('origin rewritten to a diverged commit gives pull_failed', { timeout: T }, () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'abc' });
    const o = other(w, p);
    git(o, ['reset', '-q', '--hard', 'HEAD~1'], gitEnv(w));
    commit(w, o, 'rewritten.md', 'x\n', false);
    git(o, ['push', '-q', '--force', 'origin', 'main'], gitEnv(w));
    commit(w, p.clone, 'local.md', 'l\n', false);
    const before = snapshotHost(w, p);
    const r = prep(launcher, w);
    expectRefusal(r, 'pull_failed', { status: 1 });
    expectNoDockerCall(w);
    sameHost(before, snapshotHost(w, p));
  });

  it('a new origin commit with a tag-form kit_image is bad_player_json', { timeout: T }, () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'abc' });
    const o = other(w, p);
    const j = JSON.parse(readFileSync(join(o, 'player.json'), 'utf8'));
    j.kit_image = 'registry.test/geldar-kit:latest';
    commit(w, o, 'player.json', `${JSON.stringify(j, null, 2)}\n`, true);
    const before = snapshotHost(w, p);
    const r = prep(launcher, w);
    expectRefusal(r, 'bad_player_json', { status: 1 });
    expectNoDockerCall(w);
    // The new commit was pulled (the image is read after the pull), then refused.
    expect(snapshotHost(w, p).head).not.toBe(before.head);
    expect(snapshotHost(w, p).status).toBe('');
  });

  timingIt(
    'a pull that hangs (credential prompt) is cut at the bound and is pull_failed',
    () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      const before = snapshotHost(w, p);
      const r = prep(launcher, w, {
        FAKE_GIT_SLEEP_ON: 'pull',
        FAKE_GIT_SLEEP_SEC: '60',
        GELDAR_HELPER_TIMEOUT_SEC: '2',
      });
      expectRefusal(r, 'pull_failed', { status: 1 });
      expect(r.stderr).toContain('timed out');
      expectNoDockerCall(w);
      sameHost(before, snapshotHost(w, p));
    },
    T,
  );
});
