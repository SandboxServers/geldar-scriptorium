import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forGroup, git } from '../harness.ts';
import { attack, expectHostUnchanged, expectRefusal } from './world.ts';

// H-12 (T-12): hostile objects the gate is told to accept (FAKE_VERIFY_STDOUT forces ok) are
// stopped by the host fetch itself: fetch.fsckObjects and transfer.fsckObjects. A tree that
// points at a missing blob is not here: bundle create dies first (SC-60f, bundle_failed).

const T = 240_000;
const OK = '{"ok":true,"reasons":[]}';

// The HEAD root tree plus extra raw entries ("mode name", '|' separated), written with
// hash-object --literally. PAD keeps the leading zero of the existing directory modes.
const rawTree = (entries: string, pad = false) => `export B=$(printf x | git hash-object -w --stdin)
export ENT='${entries}' PAD=${pad ? 1 : 0}
t=$(git ls-tree -z HEAD | perl -0777 -e 'my $o="";for my $r (split /\\0/,<STDIN>){$r=~/^(\\d+) \\w+ ([0-9a-f]+)\\t(.*)$/s or die;my ($m,$h,$n)=($1,$2,$3);$m=~s/^0// unless $ENV{PAD};$o.="$m $n\\0".pack("H*",$h)}for my $e (split /\\|/,$ENV{ENT}){next if $e eq "";$o.="$e\\0".pack("H*",$ENV{B})}binmode STDOUT;print $o' | git hash-object -t tree --literally -w --stdin)
c=$(git commit-tree -p HEAD -m m $t)
git update-ref refs/heads/main $c
`;

const badDate = `t=$(git rev-parse 'HEAD^{tree}')
p=$(git rev-parse HEAD)
c=$(printf 'tree %s\\nparent %s\\nauthor player-abc <player-abc@users.noreply.github.com> 99999999999999999999 +0000\\ncommitter player-abc <player-abc@users.noreply.github.com> 1700000000 +0000\\n\\nm\\n' $t $p | git hash-object -t commit --literally -w --stdin)
git update-ref refs/heads/main $c
`;

const cases: [string, string][] = [
  ['a tree entry named .git', rawTree('100644 .git')],
  ['a tree entry named .GIT', rawTree('100644 .GIT')],
  ['a tree entry named git~1', rawTree('100644 git~1')],
  ['a zero padded tree mode (040000)', rawTree('', true)],
  ['a commit with a bad timestamp', badDate],
  ['a duplicate tree entry', rawTree('100644 zzz.md|100644 zzz.md')],
];

describe.each(forGroup('hostile'))('H-12 fetch fsck ($name)', (launcher) => {
  it.each(cases)('%s ends in fetch_failed', { timeout: T }, (_n, session) => {
    const a = attack(launcher, { session, env: { FAKE_VERIFY_STDOUT: OK } });
    expect(a.finish.status, a.finish.stderr).toBe(3);
    expectRefusal(a.finish, 'fetch_failed', { status: 3 });
    expect(readFileSync(join(a.player.stateDir, 'held', 'info'), 'utf8')).toContain(
      'reason=fetch_failed',
    );
    const fetches = a.world
      .gitCalls()
      .filter((c) => c.includes('fetch') && c.some((x) => x.includes('refs/launcher/incoming')));
    expect(fetches.length, 'no host fetch of the bundle was made').toBeGreaterThan(0);
    for (const f of fetches) {
      expect(f).toContain('fetch.fsckObjects=true');
      expect(f).toContain('transfer.fsckObjects=true');
    }
    expect(git(a.player.clone, ['for-each-ref', 'refs/launcher'])).toBe('');
    expectHostUnchanged(a.before, { ...a.after, stateFiles: a.before.stateFiles });
  });
});
