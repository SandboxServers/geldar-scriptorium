import { appendFileSync, chmodSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forGroup, git, type Launcher, run } from '../harness.ts';
import { type Attack, attack, benign, expectRefusal, snapshotHost } from './world.ts';

// SC-60h, H-17 (T-17): crash recovery. A GELDAR_GIT wrapper kills the launcher process on the
// merge call (after the push); a rerun of `play` uses the stored START and never reads one from
// the workspace. A missing <state>/<id>/start with session/running present ends no_such_player.
const T = 240_000;
const win = process.platform === 'win32';

const WRAP = `#!/bin/sh
d=$(dirname "$0")
line=""
sep=""
for a in "$@"; do
  line="$line$sep$a"
  sep=$(printf '\\t')
done
[ -z "$GELDAR_TEST_GITLOG" ] || printf '%s\\n' "$line" >> "$GELDAR_TEST_GITLOG"
if [ -n "$FAKE_WRAP_KILL_ON" ] && [ ! -f "$d/wrap.done" ]; then
  for a in "$@"; do
    if [ "$a" = "$FAKE_WRAP_KILL_ON" ]; then
      : > "$d/wrap.done"
      # The bash launcher runs git inside a ( ) subshell, so $PPID is that subshell, not the
      # launcher. Climb to the topmost ancestor still running geldar-play and kill that one.
      t=$PPID
      p=$PPID
      while [ -r "/proc/$p/stat" ]; do
        tr '\0' ' ' < "/proc/$p/cmdline" | grep -q geldar-play || break
        t=$p
        p=$(sed 's/^.*) [A-Za-z] //;s/ .*//' "/proc/$p/stat")
        [ "$p" -gt 1 ] 2> /dev/null || break
      done
      kill -9 $t
      exit 1
    fi
  done
fi
exec git "$@"
`;

const envFor = (l: Launcher, a: Attack) => (l.name === 'bash' ? a.world.env : a.world.envPwsh);
const wsDir = (a: Attack) => join(a.world.dockerRoot, 'vol', 'geldar-ws-abc');

// A launcher that dies on the merge: the push is done, the host branch has not moved.
function crashed(l: Launcher): Attack {
  const a = attack(l, {
    session: benign,
    env: { FAKE_WRAP_KILL_ON: 'merge' },
    setup: (w) => {
      const p = join(w.fakeDir, 'git-wrap');
      writeFileSync(p, WRAP);
      chmodSync(p, 0o755);
    },
  });
  expect(existsSync(join(a.world.fakeDir, 'wrap.done')), 'the crash hook fired').toBe(true);
  expect(git(a.player.origin, ['log', '-1', '--format=%s', 'refs/heads/main'])).toBe('day one');
  expect(git(a.player.clone, ['rev-parse', 'HEAD'])).toBe(a.before.head);
  expect(existsSync(join(a.player.stateDir, 'start'))).toBe(true);
  expect(existsSync(join(a.player.stateDir, 'session', 'running'))).toBe(true);
  // The killed launcher could not release its lock.
  rmSync(join(a.player.stateDir, 'lock'), { recursive: true, force: true });
  return a;
}

const replay = (l: Launcher, a: Attack) =>
  run(l, ['play', 'abc'], { env: { ...envFor(l, a), FAKE_WRAP_KILL_ON: '' }, timeoutMs: T });

describe.each(forGroup('hostile'))('H-17 recovery ($name)', (launcher) => {
  // On Windows the pwsh launcher runs the wrapper through a .cmd shim, so $PPID is not the
  // launcher: the crash cases run on Linux CI for pwsh.
  const crashIt = it.skipIf(win && launcher.name === 'pwsh');

  crashIt(
    'rerun after a crash between push and merge finishes from the stored START',
    { timeout: T },
    () => {
      const a = crashed(launcher);
      const r = replay(launcher, a);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toContain('Saving it now');
      expect(r.stderr).toContain('Saved 1 commit(s)');
      const head = git(a.player.clone, ['rev-parse', 'HEAD']);
      expect(head).not.toBe(a.before.head);
      expect(head).toBe(git(a.player.origin, ['rev-parse', 'refs/heads/main']));
      expect(existsSync(wsDir(a))).toBe(false);
      expect(existsSync(join(a.player.stateDir, 'start'))).toBe(false);
    },
  );

  crashIt('a workspace that claims a later START changes nothing', { timeout: T }, () => {
    const a = crashed(launcher);
    const later = git(a.player.origin, ['rev-parse', 'refs/heads/main']);
    const w = wsDir(a);
    appendFileSync(join(w, '.git', 'config'), `[geldar]\n\tstart = ${later}\n`);
    for (const f of ['.git/START', '.git/start', 'START', 'start', 'player.start'])
      writeFileSync(join(w, f), `${later}\n`);
    const r = replay(launcher, a);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('Saved 1 commit(s)');
    expect(r.stderr).not.toContain('Nothing new to save');
    expect(git(a.player.clone, ['rev-parse', 'HEAD'])).toBe(later);
  });

  it('start removed with running present: no_such_player, nothing changed', { timeout: T }, () => {
    const a = attack(launcher, { session: benign, until: 'verify' });
    expect(a.finish.status, a.finish.stderr).toBe(0);
    rmSync(join(a.player.stateDir, 'start'));
    expect(existsSync(join(a.player.stateDir, 'session', 'running'))).toBe(true);
    const before = snapshotHost(a.world, a.player);
    const r = run(launcher, ['play', 'abc'], { env: envFor(launcher, a), timeoutMs: T });
    expectRefusal(r, 'no_such_player', { status: 1 });
    expect(r.stderr).not.toContain('did not finish');
    expect(snapshotHost(a.world, a.player)).toEqual(before);
    expect(existsSync(wsDir(a)), 'workspace volume untouched').toBe(true);
    expect(existsSync(join(a.player.stateDir, 'session', 'running'))).toBe(true);
    expect(git(a.player.origin, ['rev-parse', 'refs/heads/main'])).toBe(a.before.head);
  });
});
