import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collisionSuite, collisionText } from '../collision-suite.ts';
import { forGroup, git } from '../harness.ts';
import { attack, expectRefusal } from './world.ts';

// SC-60l: the case-collision check of the PowerShell host re-check (decision 28).
const pwsh = forGroup('hostile').filter((l) => l.name === 'pwsh');

describe.each(pwsh)('case collision ($name)', (launcher) => {
  collisionSuite(launcher);

  it('a session that turns memory/host-note.md into a directory is held', () => {
    const a = attack(launcher, {
      until: 'verify',
      env: { FAKE_VERIFY_STDOUT: '{"ok":true,"reasons":[]}', FAKE_VERIFY_RC: '0' },
      session: `b=$(printf 'x' | git hash-object -w --stdin)
      git update-index --add --cacheinfo 100644,$b,memory/Host-Note.md/x.md
      git commit -q -m collide
`,
    });
    expect(a.finish.status, a.finish.stderr).toBe(3);
    expectRefusal(a.finish, 'recheck_failed', { status: 3 });
    expect(a.finish.stderr).toContain(collisionText());
    expect(readFileSync(join(a.player.clone, 'memory', 'host-note.md'), 'utf8')).toContain('host');
    expect(git(a.player.clone, ['status', '--porcelain']).trim()).toBe('');
    expect(a.after.originRefs).toBe(a.before.originRefs);
  }, 120_000);
});
