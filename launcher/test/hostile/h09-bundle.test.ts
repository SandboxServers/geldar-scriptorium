import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forGroup, git } from '../harness.ts';
import { attack, benign, expectHostUnchanged, expectNoDockerCall, expectRefusal } from './world.ts';

// SC-60e: H-09 (T-09), a regression guard. Repo config, hooks and filters planted by the session
// in the workspace never reach the bundle helper's git; the helpers run with no network, no CLI
// volume, a read-only workspace and no privileges.

const T = 120_000;

// Planted after the last git command of the session, so only the launcher's helpers could run them.
const plant = `M="$FAKE_DOCKER_ROOT/marks"
mkdir -p "$M" "$FAKE_DOCKER_ROOT/hp" .git/hooks
git config core.fsmonitor "touch $M/fsmonitor"
git config core.hooksPath "$FAKE_DOCKER_ROOT/hp"
git config core.sshCommand "touch $M/ssh"
git config core.pager "touch $M/pager"
printf '[core]\\n\\tpager = touch %s/include\\n' "$M" > .git/extra-config
git config include.path "$PWD/.git/extra-config"
for h in pre-commit post-commit pre-push post-checkout post-merge reference-transaction pre-auto-gc; do
  printf '#!/bin/sh\\ntouch "%s/hook-%s"\\n' "$M" "$h" > ".git/hooks/$h"
  chmod +x ".git/hooks/$h"
  cp ".git/hooks/$h" "$FAKE_DOCKER_ROOT/hp/$h"
done
git config filter.evil.clean "touch $M/clean; cat"
git config filter.evil.smudge "touch $M/smudge; cat"
printf '* filter=evil\\n' > .gitattributes
printf '* filter=evil\\n' > .git/info/attributes
`;

// 10 000 tags and branches, written straight into packed-refs (10 000 loose files are slow on NTFS).
const manyRefs = `git for-each-ref --format='%(objectname) %(refname)' > .git/packed-refs.new
sha=$(git rev-parse HEAD)
awk -v s="$sha" 'BEGIN { for (i = 0; i < 10000; i++) { print s " refs/tags/t" i; print s " refs/heads/b" i } }' >> .git/packed-refs.new
mv .git/packed-refs.new .git/packed-refs
test "$(git for-each-ref | wc -l)" -gt 10000
`;

const flagPair = (argv: string[], a: string, b: string) => {
  const i = argv.indexOf(a);
  return i >= 0 && argv[i + 1] === b;
};

const headsOf = (a: ReturnType<typeof attack>) =>
  git(a.player.clone, ['bundle', 'list-heads', join(a.player.stateDir, 'session', 'bundle.bundle')])
    .split('\n')
    .filter(Boolean);

describe.each(forGroup('hostile'))('H-09 bundle isolation ($name)', (launcher) => {
  it('planted repo config, hooks and filters never run; one head; helpers locked down', {
    timeout: T,
  }, () => {
    const a = attack(launcher, { until: 'verify', session: `${benign}${plant}` });
    expect(a.finish.status, a.finish.stderr).toBe(0);
    expect(a.finish.stderr).toContain('The check of the session passed.');
    expect(readdirSync(join(a.world.dockerRoot, 'marks')), 'a planted command ran').toEqual([]);
    const heads = headsOf(a);
    expect(heads).toHaveLength(1);
    expect(heads[0]).toMatch(/^[0-9a-f]{40} refs\/heads\/main$/);
    const helpers = a.world
      .calls()
      .filter((c) => c[0] === 'run' && /geldar\.role=(bundle|verify)/.test(c.join(' ')));
    expect(helpers.map((c) => c.find((x) => x.startsWith('geldar.role='))).sort()).toEqual([
      'geldar.role=bundle',
      'geldar.role=verify',
    ]);
    for (const c of helpers) {
      expect(flagPair(c, '--network', 'none'), c.join(' ')).toBe(true);
      expect(flagPair(c, '--cap-drop', 'ALL'), c.join(' ')).toBe(true);
      expect(flagPair(c, '--security-opt', 'no-new-privileges'), c.join(' ')).toBe(true);
      expect(
        c.some((x) => x.includes('geldar-cli-')),
        c.join(' '),
      ).toBe(false);
    }
    const bundle = helpers.find((c) => c.includes('geldar.role=bundle')) ?? [];
    expect(bundle).toContain('geldar-ws-abc:/player:ro');
    // --until verify leaves start and mode in the state dir: compare the rest of the host.
    expect({ ...a.after, stateFiles: '' }).toEqual({ ...a.before, stateFiles: '' });
  });

  it('10 000 loose tags and branches give a bundle with only refs/heads/<branch>', {
    timeout: T,
  }, () => {
    const a = attack(launcher, { until: 'verify', session: `${benign}${manyRefs}` });
    expect(a.finish.status, a.finish.stderr).toBe(0);
    const heads = headsOf(a);
    expect(heads).toHaveLength(1);
    expect(heads[0]).toMatch(/ refs\/heads\/main$/);
  });

  it.each([
    ['a space', 'my branch'],
    ['a semicolon', 'a;touch x'],
  ])('a branch file with %s gives bad_branch before any docker call', { timeout: T }, (_n, br) => {
    const a = attack(launcher, {
      session: benign,
      expectRun: false,
      setup: (_w, p) => writeFileSync(join(p.stateDir, 'branch'), `${br}\n`),
    });
    expectRefusal(a.prepare, 'bad_branch', { status: 1 });
    expectNoDockerCall(a.world);
    expectHostUnchanged(a.before, a.after);
  });
});
