import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forGroup } from '../harness.ts';
import { attack, expectHostUnchanged, expectRefusal } from './world.ts';

// SC-60c, H-03 (T-03): START is the commit the launcher recorded on the host. A session that
// plants START look-alikes and rewinds below it cannot move it.
const T = 120_000;

// Branch START and tag start (a tag START would collide with it on a case-insensitive disk),
// a file start at the workspace root, then a rewind below START and a new commit.
const session = `git branch START
git tag start
echo planted > start
git reset -q --hard HEAD~1
mkdir -p memory
echo rewritten > memory/rewritten.md
git add memory/rewritten.md
git commit -q -m rewritten
`;

describe.each(forGroup('hostile'))('H-03 start ($name)', (launcher) => {
  it('a rewind below START is held; START is read from the host, never the workspace', {
    timeout: T,
  }, () => {
    const a = attack(launcher, { session });
    expect(a.ran).toBe(true);
    const start = a.before.head;
    expectRefusal(a.finish, 'reason_not_fast_forward', { status: 3 });
    // The stored start is unchanged and the hold records it.
    expect(readFileSync(join(a.player.stateDir, 'start'), 'utf8').trim()).toBe(start);
    const info = readFileSync(join(a.player.stateDir, 'held', 'info'), 'utf8');
    expect(info).toContain('reason=verify_rejected');
    expect(info).toContain(`start=${start}`);
    expect(a.finish.stderr).not.toContain('not_fast_forward');
    // The planted refs and file really exist in the workspace (the attack is not a no-op).
    const ws = join(a.world.dockerRoot, 'vol', 'geldar-ws-abc');
    expect(existsSync(join(ws, 'start'))).toBe(true);
    // No host git call touched the workspace to read START.
    const touching = a.world.gitCalls().filter((c) => c.some((x) => x.includes('geldar-ws-')));
    expect(touching).toEqual([]);
    // The host clone did not move; only the launcher's own state files were added.
    expectHostUnchanged({ ...a.before, stateFiles: '' }, { ...a.after, stateFiles: '' });
  });
});
