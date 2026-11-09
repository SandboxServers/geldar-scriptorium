import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forGroup } from '../harness.ts';
import { type Attack, attack, benign, expectHostUnchanged, expectRefusal } from './world.ts';

// H-11 (T-11): every verdict reason a session can cause ends in a hold with the launcher's own
// text and never the raw id. "real gate" cases run the real geldar-verify; "text mapping" cases
// forge the verdict through FAKE_VERIFY_STDOUT.

// stateFiles is not compared: prepare writes start and mode after the "before" snapshot.
const T = 120_000;
const REASONS = [
  'bad_arguments',
  'verify_error',
  'bundle_too_large',
  'bundle_unreadable',
  'bundle_refs_unexpected',
  'bundle_fetch_failed',
  'too_many_commits',
  'not_fast_forward',
  'merge_commit',
  'identity_mismatch',
  'identity_changed',
  'path_not_allowed',
  'symlink_not_allowed',
  'gitlink_not_allowed',
  'executable_not_allowed',
  'bad_mode',
];

const heldInfo = (a: Attack) => readFileSync(join(a.player.stateDir, 'held', 'info'), 'utf8');

const other = 'GIT_AUTHOR_NAME=Other GIT_AUTHOR_EMAIL=o@example.test';
const otherCommitter = 'GIT_COMMITTER_NAME=Other GIT_COMMITTER_EMAIL=o@example.test';

// The index entry for `path` is added through plumbing, so no file is made in the workspace.
const stage = (path: string, mode = '100644', content = 'x') =>
  `b=$(printf '%s' '${content}' | git hash-object -w --stdin)
git update-index --add --cacheinfo ${mode},$b,'${path}'
`;
const plumb = (path: string, mode?: string, content?: string) =>
  `${stage(path, mode, content)}git commit -q -m m\n`;

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

// A root tree with one extra raw entry, written with hash-object --literally.
const rawTree = (entry: string, shaExpr: string) => `export B=${shaExpr}
t=$(git ls-tree -z HEAD | perl -0777 -e 'my $o="";for my $r (split /\\0/,<STDIN>){$r=~/^(\\d+) \\w+ ([0-9a-f]+)\\t(.*)$/s or die;my $m=$1;$m=~s/^0//;$o.="$m $3\\0".pack("H*",$2)}$o.="${entry}\\0".pack("H*",$ENV{B});binmode STDOUT;print $o' | git hash-object -t tree --literally -w --stdin)
c=$(git commit-tree -p HEAD -m m $t)
git update-ref refs/heads/main $c
`;

const addA = 'mkdir -p memory\necho a > memory/a.md\ngit add memory/a.md\n';

const cases: [string, string, string[]][] = [
  ['too_many_commits (2001 commits)', many, ['too_many_commits']],
  [
    'not_fast_forward (rewind to a new root)',
    'git update-ref refs/heads/main $(git commit-tree -m rewrite $(git write-tree))\n',
    ['not_fast_forward'],
  ],
  ['merge_commit', merge, ['merge_commit']],
  ['identity_mismatch (author)', `${addA}${other} git commit -q -m m\n`, ['identity_mismatch']],
  [
    'identity_mismatch (committer only)',
    `${addA}${otherCommitter} git commit -q -m m\n`,
    ['identity_mismatch'],
  ],
  [
    'identity_changed (play)',
    'echo changed >> memory/identity.md\ngit add memory/identity.md\ngit commit -q -m m\n',
    ['identity_changed'],
  ],
  [
    'path_not_allowed CLAUDE.md',
    'echo x >> CLAUDE.md\ngit add CLAUDE.md\ngit commit -q -m m\n',
    ['path_not_allowed'],
  ],
  ['path_not_allowed .mcp.json', plumb('.mcp.json', '100644', '{}'), ['path_not_allowed']],
  ['path_not_allowed memory/x.exe', plumb('memory/x.exe'), ['path_not_allowed']],
  ['path_not_allowed memory/.hidden.md', plumb('memory/.hidden.md'), ['path_not_allowed']],
  [
    'path_not_allowed a 201-character path',
    plumb(`memory/${'a'.repeat(191)}.md`),
    ['path_not_allowed'],
  ],
  ['path_not_allowed memory/aux.md', plumb('memory/aux.md'), ['path_not_allowed']],
  ['path_not_allowed a trailing dot', plumb('memory/note.'), ['path_not_allowed']],
  ['symlink_not_allowed', plumb('memory/x.md', '120000', 'target'), ['symlink_not_allowed']],
  [
    'gitlink_not_allowed (a submodule entry)',
    'git update-index --add --cacheinfo 160000,$(git rev-parse HEAD),memory/sub\ngit commit -q -m m\n',
    ['gitlink_not_allowed'],
  ],
  ['executable_not_allowed (100755)', plumb('memory/run.md', '100755'), ['executable_not_allowed']],
  [
    'bad_mode (100664 by plumbing)',
    rawTree('100664 zzz.md', '$(printf x | git hash-object -w --stdin)'),
    ['bad_mode'],
  ],
  [
    'multi-cause shows every text',
    `echo x >> CLAUDE.md\ngit add CLAUDE.md\n${stage('memory/run.md', '100755')}${other} git commit -q -m m\n`,
    ['path_not_allowed', 'executable_not_allowed', 'identity_mismatch'],
  ],
];

describe.each(forGroup('hostile'))('H-11 gate verdicts ($name)', (launcher) => {
  describe('real gate', () => {
    it.each(cases)('%s', { timeout: T }, (_n, session, keys) => {
      const a = attack(launcher, { session, until: 'verify' });
      expect(a.finish.status, a.finish.stderr).toBe(3);
      for (const k of keys) expectRefusal(a.finish, `reason_${k}`, { status: 3 });
      for (const id of REASONS) expect(a.finish.stderr, id).not.toContain(id);
      expect(heldInfo(a)).toContain('reason=verify_rejected');
      expectHostUnchanged(a.before, { ...a.after, stateFiles: a.before.stateFiles });
    });

    it('bundle_failed: a tree that points at a missing blob', { timeout: T }, () => {
      const a = attack(launcher, {
        session: rawTree('100644 zzz.md', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
        until: 'verify',
      });
      expect(a.finish.status, a.finish.stderr).toBe(3);
      expectRefusal(a.finish, 'bundle_failed', { status: 3 });
      expect(heldInfo(a)).toContain('reason=bundle_failed');
      expectHostUnchanged(a.before, { ...a.after, stateFiles: a.before.stateFiles });
    });

    it('setup mode accepts the identity change', { timeout: T }, () => {
      const a = attack(launcher, {
        mode: 'setup',
        until: 'verify',
        session:
          'echo "I am Abc." > memory/identity.md\ngit add memory/identity.md\ngit commit -q -m born\n',
      });
      expect(a.finish.status, a.finish.stderr).toBe(0);
      expect(a.finish.stderr).toContain('The check of the session passed.');
    });
  });

  describe('text mapping (forged verdicts)', () => {
    it.each(['bundle_refs_unexpected', 'bundle_unreadable'])('%s', { timeout: T }, (id) => {
      const a = attack(launcher, {
        session: benign,
        until: 'verify',
        env: { FAKE_VERIFY_STDOUT: `{"ok":false,"reasons":["${id}"]}`, FAKE_VERIFY_RC: '1' },
      });
      expect(a.finish.status, a.finish.stderr).toBe(3);
      expectRefusal(a.finish, `reason_${id}`, { status: 3 });
      expect(a.finish.stderr).not.toContain(id);
      expect(heldInfo(a)).toContain('reason=verify_rejected');
      expectHostUnchanged(a.before, { ...a.after, stateFiles: a.before.stateFiles });
    });
  });
});
