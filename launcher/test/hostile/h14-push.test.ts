import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bashPath, forGroup, git, type Player, type World } from '../harness.ts';
import { type Attack, attack, benign, expectHostUnchanged, expectRefusal } from './world.ts';

// SC-60h, H-14 (T-14): the order of the push. "Something happens between two launcher steps" is
// one GELDAR_GIT wrapper written here: it logs its argv, and on the first call that names
// FAKE_WRAP_ON it first runs an action script, then runs the real git.
const T = 180_000;

const WRAP = `#!/bin/sh
d=$(dirname "$0")
line=""
sep=""
for a in "$@"; do
  line="$line$sep$a"
  sep=$(printf '\t')
done
[ -z "$GELDAR_TEST_GITLOG" ] || printf '%s\n' "$line" >> "$GELDAR_TEST_GITLOG"
if [ -n "$FAKE_WRAP_ON" ] && [ ! -f "$d/wrap.done" ]; then
  for a in "$@"; do
    if [ "$a" = "$FAKE_WRAP_ON" ]; then
      : > "$d/wrap.done"
      [ -z "$FAKE_WRAP_ACTION" ] || sh "$d/wrap.action"
      break
    fi
  done
fi
exec git "$@"
`;

const wrap = (w: World, action = '') => {
  const p = join(w.fakeDir, 'git-wrap');
  writeFileSync(p, WRAP);
  chmodSync(p, 0o755);
  writeFileSync(join(w.fakeDir, 'wrap.action'), action);
};

const heldReason = (a: Attack) =>
  readFileSync(join(a.player.stateDir, 'held', 'info'), 'utf8').match(/^reason=(.*)$/m)?.[1];
const calls = (a: Attack) => a.world.gitCalls();
const names = (a: Attack, sub: string) => calls(a).filter((c) => c.includes(sub));
const originMain = (p: Player) => git(p.origin, ['rev-parse', 'refs/heads/main']);

// The session commits to origin from another clone: origin is ahead of START.
const originMoves = `t=$(mktemp -d)
git clone -q "$(git -C "$HOST_CLONE" remote get-url origin)" "$t/o"
git -C "$t/o" commit -q --allow-empty -m elsewhere
git -C "$t/o" push -q origin main
`;

describe.each(forGroup('hostile'))('H-14 push order ($name)', (launcher) => {
  it('(a) the host branch moving during the session is host_moved, nothing pushed', {
    timeout: T,
  }, () => {
    const a = attack(launcher, {
      session: `${benign}git -C "$HOST_CLONE" commit -q --allow-empty -m host-moved\n`,
    });
    expectRefusal(a.finish, 'host_moved', { status: 3 });
    expect(heldReason(a)).toBe('host_moved');
    expect(names(a, 'push')).toEqual([]);
    expect(names(a, 'merge')).toEqual([]);
    expect(a.after.head).not.toBe(a.before.head);
    expect(git(a.player.clone, ['log', '-1', '--format=%s'])).toBe('host-moved');
    expect(a.after.originRefs).toBe(a.before.originRefs);
  });

  it('(b) origin moved after START: the push is refused, not forced', { timeout: T }, () => {
    const a = attack(launcher, { session: `${originMoves}${benign}` });
    expectRefusal(a.finish, 'push_failed', { status: 3 });
    expect(heldReason(a)).toBe('push_failed');
    const pushes = names(a, 'push');
    expect(pushes.length).toBeGreaterThan(0);
    for (const c of pushes) {
      expect(c).not.toContain('--force');
      expect(c).not.toContain('-f');
      expect(c.some((x) => x.startsWith('+') || x.includes(':+'))).toBe(false);
    }
    expect(names(a, 'merge')).toEqual([]);
    expect(a.after.head).toBe(a.before.head);
    expect(a.after.status).toBe(a.before.status);
    expect(git(a.player.origin, ['log', '-1', '--format=%s', 'refs/heads/main'])).toBe('elsewhere');
  });

  it('(c) the push names the verified SHA, even if refs/launcher/incoming moves', {
    timeout: T,
  }, () => {
    let start = '';
    const a = attack(launcher, {
      session: benign,
      env: { FAKE_WRAP_ON: 'push', FAKE_WRAP_ACTION: '1' },
      setup: (w, p) => {
        start = git(p.clone, ['rev-parse', 'HEAD']);
        wrap(w, `git -C '${bashPath(p.clone)}' update-ref refs/launcher/incoming ${start}\n`);
      },
    });
    expect(existsSync(join(a.world.fakeDir, 'wrap.done')), 'the race action ran').toBe(true);
    const push = names(a, 'push')[0] ?? [];
    const spec = push[push.indexOf('origin') + 1] ?? '';
    const [sha, ref] = spec.split(':');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(ref).toBe('refs/heads/main');
    expect(sha).not.toBe(start);
    expect(push.some((x) => x === '--force' || x === '-f' || x.startsWith('+'))).toBe(false);
    expect(originMain(a.player)).toBe(sha);
    expect(git(a.player.origin, ['log', '-1', '--format=%s', 'refs/heads/main'])).toBe('day one');
  });

  it('(d) a failing fast-forward is ff_failed and the host branch does not move', {
    timeout: T,
  }, () => {
    const a = attack(launcher, {
      session: benign,
      env: { GELDAR_TEST_FORCE_FF_FAIL: '1' },
    });
    expectRefusal(a.finish, 'ff_failed', { status: 3 });
    expect(heldReason(a)).toBe('ff_failed');
    expect(a.after.head).toBe(a.before.head);
    expect(a.after.status).toBe(a.before.status);
    expect(originMain(a.player)).not.toBe(a.before.head);
  });

  it('(e) host pre-push and post-merge hooks never run', { timeout: T }, () => {
    let marks = '';
    const a = attack(launcher, {
      session: benign,
      setup: (w, p) => {
        marks = join(w.root, 'hookmark');
        const hooks = join(w.root, 'host-hooks');
        mkdirSync(hooks, { recursive: true });
        for (const h of ['pre-push', 'post-merge', 'pre-commit', 'reference-transaction']) {
          const body = `#!/bin/sh\n: > '${bashPath(marks)}.${h}'\n`;
          for (const dir of [hooks, join(p.clone, '.git', 'hooks')]) {
            writeFileSync(join(dir, h), body);
            chmodSync(join(dir, h), 0o755);
          }
        }
        git(p.clone, ['config', 'core.hooksPath', bashPath(hooks)]);
      },
    });
    expect(a.finish.status, a.finish.stderr).toBe(0);
    expect(a.after.head).not.toBe(a.before.head);
    for (const h of ['pre-push', 'post-merge', 'pre-commit', 'reference-transaction'])
      expect(existsSync(`${marks}.${h}`), `hook ${h} ran`).toBe(false);
    for (const c of [...names(a, 'push'), ...names(a, 'merge')])
      expect(c.some((x) => x.startsWith('core.hooksPath='))).toBe(true);
    // Control: plain git in the same clone does run these hooks, so the marker can fire.
    const here = a.player.clone;
    git(here, ['reset', '-q', '--hard', 'HEAD~1']);
    git(here, ['merge', '-q', '--ff-only', a.after.head]);
    expect(existsSync(`${marks}.post-merge`), 'control: hooks are live').toBe(true);
  });

  it('a clean session pushes once and ends with host == origin', { timeout: T }, () => {
    const a = attack(launcher, { session: benign });
    expect(a.finish.status, a.finish.stderr).toBe(0);
    expect(names(a, 'push')).toHaveLength(1);
    expect(a.after.head).toBe(originMain(a.player));
    expectHostUnchanged(a.before, a.after, { advancedBranch: true });
  });
});
