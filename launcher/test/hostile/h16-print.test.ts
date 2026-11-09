import { describe, expect, it } from 'vitest';
import { forGroup } from '../harness.ts';
import { attack, expectHostUnchanged } from './world.ts';

// H-16 (T-16): every bundle-derived string the launcher prints (commit subjects in the saved
// log, paths in RC_WHY, forged verdict text) is stripped of ESC, BEL and C1 controls.
// The launcher prints no author, branch or tag name.

const T = 120_000;
const OK = '{"ok":true,"reasons":[]}';
const NASTY =
  'day \\033[31mred\\033]0;pwned\\007 \\302\\233 \\342\\200\\256 \\342\\202\\254 \\346\\227\\245\\346\\234\\254 end';
const NEWLINES = `$(printf '${'\\n'.repeat(20)}')`;

const bad = (s: string) =>
  [...s].some((c) => {
    const n = c.codePointAt(0) ?? 0;
    return n === 0x1b || n === 0x07 || (n >= 0x80 && n <= 0x9f);
  });
const oneLinePerMessage = (s: string) =>
  s
    .split('\n')
    .filter((l) => l.length > 0)
    .every((l) => l.startsWith('geldar-play: ') || l.startsWith('  '));

describe.each(forGroup('hostile'))('H-16 printed text ($name)', (launcher) => {
  it('commit subjects in the saved log carry no control bytes; UTF-8 survives', {
    timeout: T,
  }, () => {
    const a = attack(launcher, {
      session: `mkdir -p memory/journal
echo hello > memory/journal/day-001.md
git add memory
subj=$(printf '${NASTY}')
git commit -q -m "$subj${NEWLINES}body"
`,
    });
    expect(a.finish.status, a.finish.stderr).toBe(0);
    for (const out of [a.finish.stdout, a.finish.stderr]) {
      expect(bad(out), JSON.stringify(out)).toBe(false);
      expect(oneLinePerMessage(out), JSON.stringify(out)).toBe(true);
    }
    expect(a.finish.stderr).toContain('€ 日本 end');
    expect(a.finish.stderr).toContain('pwned');
    expect(a.finish.stderr.split('\n').filter((l) => l.startsWith('  ')).length).toBe(1);
    expectHostUnchanged(
      a.before,
      { ...a.after, stateFiles: a.before.stateFiles },
      { advancedBranch: true },
    );
  });

  it('documented limit: a bidi override passes the filter (FINDING)', { timeout: T }, () => {
    const a = attack(launcher, {
      session: `mkdir -p memory/journal
echo hello > memory/journal/day-001.md
git add memory
git commit -q -m "$(printf 'left \\342\\200\\256 right')"
`,
    });
    expect(a.finish.status, a.finish.stderr).toBe(0);
    // U+202E is outside the C0/DEL/C1 class today; the strict case is in the report.
    expect(a.finish.stderr).toContain('left ‮ right');
  });

  it('paths in the second-check text carry no control bytes', { timeout: T }, () => {
    const a = attack(launcher, {
      until: 'verify',
      env: { FAKE_VERIFY_STDOUT: OK },
      session: `p=$(printf 'memory/\\033]0;pwned\\007\\302\\233\\342\\200\\256.md')
b=$(printf x | git hash-object -w --stdin)
git update-index --add --cacheinfo 100644,$b,"$p"
t=$(git write-tree)
m=$(printf 'subj \\033]0;pwned\\007 end')
c=$(git commit-tree -p HEAD -m "$m" $t)
git update-ref refs/heads/main $c
`,
    });
    expect(a.finish.status, a.finish.stderr).toBe(3);
    expect(a.finish.stderr).toContain('pwned');
    expect(a.finish.stderr).toContain('second check');
    for (const out of [a.finish.stdout, a.finish.stderr]) {
      expect(bad(out), JSON.stringify(out)).toBe(false);
      expect(oneLinePerMessage(out), JSON.stringify(out)).toBe(true);
    }
    expectHostUnchanged(a.before, { ...a.after, stateFiles: a.before.stateFiles });
  });

  it('a forged verdict with control bytes is never printed', { timeout: T }, () => {
    const a = attack(launcher, {
      until: 'verify',
      session: 'echo hi > memory/a.md\ngit add memory\ngit commit -q -m m\n',
      env: {
        FAKE_VERIFY_STDOUT: '{"ok":false,"reasons":["\u001b[31mpwned\u0007\u009b"]}',
        FAKE_VERIFY_RC: '1',
      },
    });
    expect(a.finish.status, a.finish.stderr).toBe(3);
    expect(a.finish.stderr).toContain('no clear answer');
    for (const out of [a.finish.stdout, a.finish.stderr]) {
      expect(out).not.toContain('pwned');
      expect(bad(out)).toBe(false);
      expect(oneLinePerMessage(out)).toBe(true);
    }
    expectHostUnchanged(a.before, { ...a.after, stateFiles: a.before.stateFiles });
  });
});
