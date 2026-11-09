import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bashPath,
  forGroup,
  git,
  type Launcher,
  makePlayer,
  makeWorld,
  repoRoot,
  run,
  type World,
} from './harness.ts';
import { timingIt } from './timing.ts';

vi.setConfig({ testTimeout: 180_000 });

const share = bashPath(join(repoRoot, 'image'));
const gitCli = bashPath(join(repoRoot, 'packages', 'git', 'src', 'cli.ts'));
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

const asPlayer = (id: string) =>
  `export GIT_AUTHOR_NAME=player-${id} GIT_AUTHOR_EMAIL=player-${id}@users.noreply.github.com
export GIT_COMMITTER_NAME=player-${id} GIT_COMMITTER_EMAIL=player-${id}@users.noreply.github.com
`;

const benign = `mkdir -p memory/journal
echo hello > memory/journal/day-001.md
node ${gitCli} commit --root . --message "day one" --mode play
`;

const ID = 'abc';

// A player with its origin and a FAKE_SESSION script. __ORIGIN__ and __CLONE__ in the script
// are replaced by the bash paths of the bare origin and of the host clone.
function prep(l: Launcher, w: World, script: string, extra: Record<string, string> = {}) {
  const p = makePlayer(w, { id: ID });
  const sf = join(w.root, 'session.sh');
  const text = script
    .replaceAll('__ORIGIN__', bashPath(p.origin))
    .replaceAll('__CLONE__', bashPath(p.clone));
  writeFileSync(sf, `${asPlayer(ID)}${text}`);
  const env = {
    ...(l.name === 'bash' ? w.env : w.envPwsh),
    GELDAR_SHARE: share,
    FAKE_SESSION: bashPath(sf),
    ...extra,
  };
  const start = git(p.clone, ['rev-parse', 'HEAD']);
  const play = (more: Record<string, string> = {}, args = ['play', ID]) =>
    run(l, args, { env: { ...env, ...more }, timeoutMs: 150_000 });
  return { p, env, start, play };
}

const originTip = (origin: string) => git(origin, ['rev-parse', 'main']);
const cloneTip = (clone: string) => git(clone, ['rev-parse', 'HEAD']);
const volDir = (w: World) => join(w.dockerRoot, 'vol', `geldar-ws-${ID}`);
const heldInfo = (stateDir: string) => readFileSync(join(stateDir, 'held', 'info'), 'utf8');
const dockerRuns = (w: World) =>
  w
    .calls()
    .filter(
      (c) => c[0] === 'run' || c[0] === 'volume' || (c[0] === 'compose' && c.includes('run')),
    );

// Every push to origin is refused.
function blockOrigin(origin: string) {
  const hook = join(origin, 'hooks', 'pre-receive');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  chmodSync(hook, 0o755);
}

// A second clone pushes a commit to origin, run from inside the session.
const moveOrigin = `OTHER=$(mktemp -d)
git clone -q __ORIGIN__ "$OTHER/o"
(cd "$OTHER/o" && echo other > memory/other.md && git add -A && git commit -q -m other && git push -q origin main)
`;

for (const l of forGroup('finish')) {
  describe(`${l.name}: fetch, push, hold and crash recovery`, () => {
    it('1. happy path: origin and the host branch hold the commit, the state is gone', () => {
      const w = makeWorld();
      const { p, play, start } = prep(l, w, benign);
      const r = play();
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toContain('Saved 1 commit(s) for abc.');
      expect(git(p.origin, ['log', 'main', '--format=%s', '-n', '1'])).toBe('day one');
      expect(cloneTip(p.clone)).toBe(originTip(p.origin));
      expect(originTip(p.origin)).not.toBe(start);
      expect(w.calls().some((c) => c[0] === 'volume' && c[1] === 'rm')).toBe(true);
      expect(existsSync(join(p.stateDir, 'session'))).toBe(false);
      expect(existsSync(join(p.stateDir, 'start'))).toBe(false);
      expect(existsSync(join(p.stateDir, 'mode'))).toBe(false);
      expect(existsSync(volDir(w))).toBe(false);
      expect(existsSync(join(p.stateDir, 'held'))).toBe(false);
    });

    it('2. H-14: a refused push holds the session and leaves the host branch alone', () => {
      const w = makeWorld();
      const { p, play, start } = prep(l, w, benign);
      blockOrigin(p.origin);
      const r = play();
      expect(r.status, r.stderr).toBe(3);
      expect(r.stderr).toContain('Could not send the memory to GitHub');
      expect(cloneTip(p.clone)).toBe(start);
      expect(originTip(p.origin)).toBe(start);
      expect(existsSync(join(p.stateDir, 'held', 'bundle.bundle'))).toBe(true);
      expect(existsSync(volDir(w))).toBe(true);
      expect(heldInfo(p.stateDir)).toContain('reason=push_failed');
      expect(heldInfo(p.stateDir)).toContain(`start=${start}`);
      expect(w.calls().some((c) => c[0] === 'volume' && c[1] === 'rm')).toBe(false);
    });

    it('3. a remote that moved rejects the push; the text is the launcher', () => {
      const w = makeWorld();
      const { p, play, start } = prep(l, w, moveOrigin + benign);
      const r = play();
      expect(r.status, r.stderr).toBe(3);
      expect(r.stderr).toContain('Could not send the memory to GitHub');
      expect(r.stderr).not.toMatch(/rejected|non-fast-forward|hint:/);
      expect(cloneTip(p.clone)).toBe(start);
      expect(existsSync(volDir(w))).toBe(true);
      expect(existsSync(join(p.stateDir, 'held', 'bundle.bundle'))).toBe(true);
      expect(originTip(p.origin)).not.toBe(start);
    });

    it('4. no force anywhere; the push is by the verified SHA', () => {
      const w = makeWorld();
      const { play } = prep(l, w, moveOrigin + benign);
      play();
      const calls = w.gitCalls();
      for (const argv of calls) {
        for (const a of argv) {
          expect(a).not.toMatch(/^--force|^-f$|^\+refs|^\+[^ ]*:/);
        }
      }
      const push = calls.find((c) => c.includes('push'));
      expect(push).toBeDefined();
      const spec = (push ?? []).at(-1) ?? '';
      expect(spec).toMatch(/^[0-9a-f]{40}:refs\/heads\/main$/);
    });

    it('5. a held session blocks play (0011)', () => {
      const w = makeWorld();
      const { p, play } = prep(l, w, benign);
      blockOrigin(p.origin);
      expect(play().status).toBe(3);
      const before = w.calls().length;
      const r = play();
      expect(r.status, r.stderr).toBe(1);
      expect(r.stderr).toContain('is being held');
      const after = w.calls().slice(before);
      expect(
        after.filter(
          (c) => c[0] === 'run' || c[0] === 'volume' || (c[0] === 'compose' && c.includes('run')),
        ),
      ).toEqual([]);
    });

    describe('6. H-17: crash recovery uses the stored START', () => {
      const crash = (l2: Launcher, w: World, script = benign) => {
        const t = prep(l2, w, script);
        const a = run(l2, ['__prepare', ID, 'play'], { env: t.env, timeoutMs: 120_000 });
        expect(a.status, a.stderr).toBe(0);
        const b = run(l2, ['__session', ID, 'play'], { env: t.env, timeoutMs: 120_000 });
        expect(b.status, b.stderr).toBe(0);
        expect(existsSync(join(t.p.stateDir, 'session', 'running'))).toBe(true);
        return t;
      };
      const verifyStart = (w: World) => {
        const v = w.calls().find((c) => c[0] === 'run' && c.includes('geldar.role=verify')) ?? [];
        return v[v.indexOf('--start') + 1];
      };

      it('a tampered start is the value the gate uses, and it rejects', () => {
        const w = makeWorld();
        const { p, play, start } = crash(l, w);
        expect(originTip(p.origin)).toBe(start);
        const tampered = git(p.clone, ['rev-parse', 'HEAD^']);
        writeFileSync(join(p.stateDir, 'start'), `${tampered}\n`);
        const r = play();
        expect(r.status, r.stderr).toBe(3);
        expect(r.stderr).toContain('Saving it now');
        expect(verifyStart(w)).toBe(tampered);
        expect(r.stderr).toContain('name that is not the player');
        expect(heldInfo(p.stateDir)).toContain('reason=verify_rejected');
        expect(originTip(p.origin)).toBe(start);
        expect(cloneTip(p.clone)).toBe(start);
        expect(w.gitCalls().some((c) => c.includes('push'))).toBe(false);
        expect(existsSync(join(p.stateDir, 'held', 'bundle.bundle'))).toBe(true);
      });

      it('an untampered start ends as the happy path with the stored value', () => {
        const w = makeWorld();
        const { p, play } = crash(l, w);
        const stored = readFileSync(join(p.stateDir, 'start'), 'utf8').trim();
        const r = play();
        expect(r.status, r.stderr).toBe(0);
        expect(verifyStart(w)).toBe(stored);
        expect(git(p.origin, ['log', 'main', '--format=%s', '-n', '1'])).toBe('day one');
      });

      it('a missing volume clears the state, then a normal run', () => {
        const w = makeWorld();
        const { p, play } = crash(l, w);
        rmSync(volDir(w), { recursive: true, force: true });
        const r = play();
        expect(r.status, r.stderr).toBe(0);
        expect(r.stderr).toContain('leftover state was cleared');
        expect(r.stderr).toContain('Saved 1 commit(s) for abc.');
        expect(git(p.origin, ['log', 'main', '--format=%s', '-n', '1'])).toBe('day one');
      });
    });

    it('7. H-15: a gate rejection keeps everything', () => {
      const w = makeWorld();
      const hostile = 'echo x >> CLAUDE.md\ngit add CLAUDE.md\ngit commit -q -m m\n';
      const { p, play, start } = prep(l, w, hostile);
      const r = play();
      expect(r.status, r.stderr).toBe(3);
      // The rejection is the gate's, for the right reason, not a script that did nothing.
      expect(r.stderr).toContain('something a player may not change');
      expect(heldInfo(p.stateDir)).toContain('reason=verify_rejected');
      // The attack payload really was in the bundle: it holds a tip beyond the start.
      const heads = git(p.clone, [
        'bundle',
        'list-heads',
        join(p.stateDir, 'held', 'bundle.bundle'),
      ]);
      expect(heads).toMatch(/[0-9a-f]{40}/);
      expect(heads).not.toContain(start);
      expect(cloneTip(p.clone)).toBe(start);
      expect(originTip(p.origin)).toBe(start);
      expect(existsSync(volDir(w))).toBe(true);
      expect(existsSync(join(p.stateDir, 'held', 'bundle.bundle'))).toBe(true);
    });

    it('8. H-12: the fetch checks objects', () => {
      const w = makeWorld();
      const { play } = prep(l, w, benign);
      expect(play().status).toBe(0);
      const f = w
        .gitCalls()
        .find((c) => c.includes('fetch') && c.some((a) => a.endsWith(':refs/launcher/incoming')));
      expect(f).toBeDefined();
      expect(f).toContain('fetch.fsckObjects=true');
      expect(f).toContain('transfer.fsckObjects=true');
    });

    it('9. a commit by the human during the session holds as host_moved', () => {
      const w = makeWorld();
      const human =
        '(cd __CLONE__ && echo h > human.txt && git add -A && git commit -q -m human)\n';
      const { p, play, start } = prep(l, w, human + benign);
      const r = play();
      expect(r.status, r.stderr).toBe(3);
      expect(r.stderr).toContain('changed during the session');
      expect(heldInfo(p.stateDir)).toContain('reason=host_moved');
      expect(originTip(p.origin)).toBe(start);
      expect(git(p.clone, ['log', '-1', '--format=%s'])).toBe('human');
      expect(w.gitCalls().some((c) => c.includes('push'))).toBe(false);
    });

    it('10. a session with no new commit pushes nothing and cleans up', () => {
      const w = makeWorld();
      const { p, play, start } = prep(l, w, 'true\n');
      const r = play();
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toContain('Nothing new to save');
      expect(originTip(p.origin)).toBe(start);
      expect(w.gitCalls().some((c) => c.includes('push'))).toBe(false);
      expect(existsSync(volDir(w))).toBe(false);
      expect(existsSync(join(p.stateDir, 'session'))).toBe(false);
    });

    it('11. a commit subject with an escape sequence never reaches the output raw', () => {
      const w = makeWorld();
      const script = [
        'mkdir -p memory/journal',
        'echo hi > memory/journal/day-001.md',
        'git add memory/journal/day-001.md',
        'git commit -q -m "$(printf \'subj \\033]0;pwned\\007 end\')"',
        '',
      ].join('\n');
      const { play } = prep(l, w, script);
      const r = play();
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toContain('pwned');
      for (const out of [r.stdout, r.stderr]) {
        expect(out.includes(ESC)).toBe(false);
        expect(out.includes(BEL)).toBe(false);
      }
    });

    it('12. a failed fast-forward after the push holds as ff_failed', () => {
      const w = makeWorld();
      const { p, play, start } = prep(l, w, benign);
      const r = play({ GELDAR_TEST_FORCE_FF_FAIL: '1' });
      expect(r.status, r.stderr).toBe(3);
      expect(heldInfo(p.stateDir)).toContain('reason=ff_failed');
      expect(git(p.origin, ['log', 'main', '--format=%s', '-n', '1'])).toBe('day one');
      expect(cloneTip(p.clone)).toBe(start);
      expect(existsSync(volDir(w))).toBe(true);
      expect(dockerRuns(w).length).toBeGreaterThan(0);
    });

    timingIt(
      '13. B5: a hung push is bounded and held',
      () => {
        const w = makeWorld();
        const pidfile = join(w.root, 'pids');
        const { p, play, start } = prep(l, w, benign, {
          GELDAR_HELPER_TIMEOUT_SEC: '2',
          FAKE_GIT_SLEEP_ON: 'push',
          FAKE_PIDFILE: bashPath(pidfile),
        });
        const t0 = Date.now();
        const r = play();
        expect(Date.now() - t0).toBeLessThan(60_000);
        expect(r.status, r.stderr).toBe(3);
        expect(heldInfo(p.stateDir)).toContain('reason=push_failed');
        expect(cloneTip(p.clone)).toBe(start);
        const pids = existsSync(pidfile)
          ? readFileSync(pidfile, 'utf8').split('\n').filter(Boolean).map(Number)
          : [];
        for (const pid of pids) {
          expect(() => process.kill(pid, 0)).toThrow();
        }
      },
      180_000,
    );
  });
}
