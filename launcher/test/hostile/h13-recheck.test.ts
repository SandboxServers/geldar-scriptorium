import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bashExe, bashPath, forGroup, git } from '../harness.ts';
import { type Attack, attack, benign, expectHostUnchanged, expectRefusal } from './world.ts';

// H-13 (T-13): the gate is forced ok (FAKE_VERIFY_STDOUT), so host_recheck alone must reject.
// The case-fold start-tree collision rows are in SC-60k and SC-60l. Case 5 of bundle.test.ts is
// the benign control; the rename pair below is the control for --no-renames.

const T = 240_000;
const OK = '{"ok":true,"reasons":[]}';
const win = process.platform === 'win32';

const commit = (extra = '') => `${extra}git commit -q -m m\n`;
const stage = (path: string, mode: string) =>
  `b=$(printf x | git hash-object -w --stdin)
git update-index --add --cacheinfo ${mode},$b,'${path}'
`;

const merge = [
  'git checkout -q -b side',
  'mkdir -p memory',
  'echo a > memory/a.md',
  'git add memory/a.md',
  'git commit -q -m a',
  'git checkout -q main',
  'echo b > memory/b.md',
  'git add memory/b.md',
  'git commit -q -m b',
  'git merge -q --no-ff side -m merged',
  '',
].join('\n');

const many = `awk 'BEGIN{for(i=1;i<=2001;i++){m="c" i;print "commit refs/heads/main";print "committer player-abc <player-abc@users.noreply.github.com> " (1700000000+i) " +0000";print "data " length(m);print m;if(i==1)print "from refs/heads/main^0";print "M 100644 inline memory/n.md";d="v" i;print "data " length(d);print d;print ""}}' | git fast-import --quiet
`;

// [name, session, text inside the parentheses of recheck_failed]
const cases: [string, string, string][] = [
  [
    'a rename out of an allowed path (delete plus add)',
    `git mv memory/host-note.md EVIL.md\n${commit()}`,
    'EVIL.md',
  ],
  ['a 100755 file', `${stage('memory/run.md', '100755')}${commit()}`, 'memory/run.md'],
  ['a merge commit', merge, 'merge'],
  ['CLAUDE.md', `echo x >> CLAUDE.md\ngit add CLAUDE.md\n${commit()}`, 'CLAUDE.md'],
  ['a deleted .mcp.json', `git rm -q .mcp.json\n${commit()}`, '.mcp.json'],
  [
    'a commit that is not a descendant of START',
    'git update-ref refs/heads/main $(git commit-tree -m rewrite $(git write-tree))\n',
    'history',
  ],
  ['2001 commits', many, 'too many commits'],
];

describe.each(forGroup('hostile'))('H-13 host re-check ($name)', (launcher) => {
  it.each(cases)('%s', { timeout: T }, (_n, session, why) => {
    const a = attack(launcher, { session, env: { FAKE_VERIFY_STDOUT: OK } });
    expect(a.finish.status, a.finish.stderr).toBe(3);
    expectRefusal(a.finish, 'recheck_failed', { status: 3 });
    expect(a.finish.stderr).toContain(`(${why})`);
    expect(readFileSync(join(a.player.stateDir, 'held', 'info'), 'utf8')).toContain(
      'reason=recheck_failed',
    );
    expectHeld(a);
  });

  // The diff is made unreadable by a GELDAR_GIT wrapper that fails every `diff` call.
  it('an unreadable diff', { timeout: T }, () => {
    const env: Record<string, string> = { FAKE_VERIFY_STDOUT: OK };
    const a = attack(launcher, {
      session: benign,
      env,
      setup: (world) => {
        const real = bashPath(join(world.fakeDir, 'git-wrap'));
        const sh = join(world.fakeDir, 'git-nodiff');
        writeFileSync(
          sh,
          `#!/bin/sh\nfor a in "$@"; do [ "$a" != diff ] || exit 1; done\nexec "${real}" "$@"\n`,
        );
        chmodSync(sh, 0o755);
        if (win && launcher.name === 'pwsh') {
          const cmd = join(world.fakeDir, 'git-nodiff.cmd');
          writeFileSync(cmd, `@"${bashExe}" "${bashPath(sh)}" %*\r\n`);
          env.GELDAR_GIT = cmd;
        } else {
          env.GELDAR_GIT = bashPath(sh);
        }
      },
    });
    expect(a.finish.status, a.finish.stderr).toBe(3);
    expectRefusal(a.finish, 'recheck_failed', { status: 3 });
    expectHeld(a);
  });

  // --no-renames control: a rename from one allowed path to another allowed path is accepted,
  // and only because rename detection is off (with it on, git emits three tokens per entry).
  it('benign rename between allowed paths is accepted (--no-renames)', { timeout: T }, () => {
    const a = attack(launcher, {
      session: `git mv memory/host-note.md memory/renamed-note.md\n${commit()}`,
      env: { FAKE_VERIFY_STDOUT: OK },
    });
    expect(a.finish.status, a.finish.stderr).toBe(0);
    expect(a.after.head).not.toBe(a.before.head);
    const range = [a.before.head, a.after.head];
    const withRenames = git(a.player.clone, ['diff', '--raw', '-z', ...range]);
    const without = git(a.player.clone, ['diff', '--raw', '-z', '--no-renames', ...range]);
    expect(withRenames, 'rename detection must see an R entry').toMatch(/R\d+/);
    expect(without).not.toMatch(/R\d+/);
  });
});

// A re-check hold leaves the fetched refs/launcher/incoming in the host clone (the push and the
// merge never ran); every other host ref, the branch, the tree and origin are unchanged.
function expectHeld(a: Attack): void {
  const keep = (s: string) =>
    s
      .split('\n')
      .filter((l) => !l.includes('refs/launcher/incoming'))
      .join('\n');
  expectHostUnchanged(a.before, {
    ...a.after,
    stateFiles: a.before.stateFiles,
    cloneRefs: keep(a.after.cloneRefs),
  });
}
