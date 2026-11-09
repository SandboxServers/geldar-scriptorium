import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bashExe,
  bashPath,
  git,
  type Launcher,
  makePlayer,
  makeWorld,
  type Player,
  repoRoot,
  run,
  type World,
} from './harness.ts';
import { timingIt } from './timing.ts';
import { type Hostile, makeTemplateRelease } from './upgrade-fixture.ts';

// The whole case list of `geldar-play upgrade` (SC-64b bash, SC-64c PowerShell): both launchers run
// this one body.

vi.setConfig({ testTimeout: 180_000 });

const fakeGh = bashPath(join(repoRoot, 'launcher', 'test', 'fake-gh.sh'));
const win = process.platform === 'win32';
const ID = 'abc';
const HOST = { name: 'Host', email: 'host@example.test' };
const FROM = '0.1.0';

type Result = ReturnType<typeof run>;

function message(key: string): string {
  const rows = readFileSync(join(repoRoot, 'launcher', 'messages.d', '90-upgrade.tsv'), 'utf8');
  const row = rows.split('\n').find((l) => l.startsWith(`${key}\t`));
  if (!row) throw new Error(`no message ${key}`);
  // The fixed text before the first placeholder.
  return (row.split('\t')[1] ?? '').split('%s')[0] ?? '';
}

interface Setup {
  w: World;
  p: Player;
  prs(): string[][];
  upgrade(
    l: Launcher,
    release: { repo: string },
    args?: string[],
    extra?: Record<string, string>,
  ): Result;
  all(r: Result): string;
}

function setup(l: Launcher): Setup {
  const w = makeWorld();
  const ghRoot = join(w.root, 'gh');
  writeFileSync(join(w.fakeDir, 'gh'), `#!/bin/sh\nexec sh "${fakeGh}" "$@"\n`);
  chmodSync(join(w.fakeDir, 'gh'), 0o755);
  if (win && bashExe) writeFileSync(join(w.fakeDir, 'gh.cmd'), `@"${bashExe}" "${fakeGh}" %*\r\n`);
  writeFileSync(
    join(w.root, 'gitconfig'),
    `[user]\n\tname = ${HOST.name}\n\temail = ${HOST.email}\n[init]\n\tdefaultBranch = main\n`,
  );
  const p = makePlayer(w, { id: ID });
  // The player is at FROM: one more host commit that sets the version, pushed.
  const gitEnv = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
  const pj = join(p.clone, 'player.json');
  const cur = JSON.parse(readFileSync(pj, 'utf8'));
  cur.kit_version = FROM;
  writeFileSync(pj, `${JSON.stringify(cur, null, 2)}\n`);
  git(p.clone, ['commit', '-q', '-am', 'set kit version'], gitEnv);
  git(p.clone, ['push', '-q', 'origin', 'main'], gitEnv);
  const prs = () => {
    const f = join(ghRoot, 'prs.log');
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'));
  };
  const upgrade = (
    launcher: Launcher,
    release: { repo: string },
    args: string[] = [],
    extra: Record<string, string> = {},
  ) => {
    const bash = launcher.name === 'bash';
    const env = {
      ...(bash ? w.env : w.envPwsh),
      GELDAR_GH: bash ? bashPath(join(w.fakeDir, 'gh')) : join(w.fakeDir, win ? 'gh.cmd' : 'gh'),
      GELDAR_TEMPLATE_URL: bash ? bashPath(release.repo) : release.repo,
      GELDAR_SLEEP: '0',
      FAKE_GH_ROOT: bashPath(ghRoot),
      GIT_AUTHOR_NAME: HOST.name,
      GIT_AUTHOR_EMAIL: HOST.email,
      GIT_COMMITTER_NAME: HOST.name,
      GIT_COMMITTER_EMAIL: HOST.email,
      ...extra,
    };
    return run(launcher, ['upgrade', ID, ...args], { env, timeoutMs: 170_000 });
  };
  void l;
  return { w, p, prs, upgrade, all: (r) => `${r.stdout}\n${r.stderr}` };
}

// Everything a refused upgrade must leave alone.
function snap(s: Setup): Record<string, string> {
  const c = s.p.clone;
  return {
    head: git(c, ['rev-parse', 'HEAD']),
    branch: git(c, ['rev-parse', '--abbrev-ref', 'HEAD']),
    branches: git(c, ['for-each-ref', 'refs/heads']),
    status: git(c, ['status', '--porcelain']),
    origin: git(s.p.origin, ['for-each-ref']),
    prs: String(s.prs().length),
  };
}

const HOSTILE: Hostile[] = [
  'symlink',
  'gitlink',
  'newline-name',
  'tag-form-image',
  'traversal',
  'git-hooks',
  'big-file',
  'version-mismatch',
  'image-mismatch',
];

const branchName = (c: string) => git(c, ['rev-parse', '--abbrev-ref', 'HEAD']);

export function upgradeSuite(l: Launcher): void {
  describe(`upgrade (${l.name})`, () => {
    it('1. benign: a pull request from a one-commit branch, memory and skills untouched', () => {
      const s = setup(l);
      const o = s.p.origin;
      const r = makeTemplateRelease(s.w, {
        versions: ['0.2.0'],
        files: { 'AGENTS.md': null, 'NEW.md': 'new kit file\n' },
        hostile: 'memory-content',
      });
      const before = snap(s);
      const agentsBefore = git(s.p.clone, ['show', 'HEAD:AGENTS.md']);
      const res = s.upgrade(l, r, ['--to', '0.2.0']);
      expect(res.status, s.all(res)).toBe(0);
      expect(s.all(res)).toContain('https://github.test/pull/1');
      expect(git(o, ['rev-list', '--count', 'main..kit-upgrade/0.2.0'])).toBe('1');
      const onBranch = (path: string) => git(o, ['show', `kit-upgrade/0.2.0:${path}`]);
      expect(onBranch('CLAUDE.md')).toBe('Kit claude file.');
      expect(onBranch('NEW.md')).toBe('new kit file');
      expect(git(o, ['ls-tree', '--name-only', 'kit-upgrade/0.2.0'])).not.toContain('AGENTS.md');
      const old = JSON.parse(git(o, ['show', 'main:player.json']));
      expect(JSON.parse(onBranch('player.json'))).toEqual({
        ...old,
        kit_version: '0.2.0',
        kit_image: r.kitImage('0.2.0'),
      });
      expect(onBranch('player.json')).not.toContain('\r');
      expect(git(o, ['diff', 'main', 'kit-upgrade/0.2.0', '--', 'memory', 'skills'])).toBe('');
      const msg = git(o, ['log', '-1', '--format=%an%n%B', 'kit-upgrade/0.2.0']);
      expect(msg).toContain(HOST.name);
      expect(msg).toContain('upgrade the kit to 0.2.0');
      expect(msg).toContain(`image: ${r.digest('0.2.0')}`);
      const after = snap(s);
      expect({ ...after, origin: '', prs: '' }).toEqual({ ...before, origin: '', prs: '' });
      expect(git(s.p.clone, ['show', 'HEAD:AGENTS.md'])).toBe(agentsBefore);
      expect(git(o, ['rev-parse', 'main'])).toBe(before.head);
      const pr = s.prs();
      expect(pr).toHaveLength(1);
      const argv = pr[0] ?? [];
      expect(argv[argv.indexOf('--base') + 1]).toBe('main');
      expect(argv[argv.indexOf('--head') + 1]).toBe('kit-upgrade/0.2.0');
    });

    it('2. the same version is current, a lower one is refused', () => {
      const s = setup(l);
      const same = makeTemplateRelease(s.w, { versions: [FROM] });
      const before = snap(s);
      let res = s.upgrade(l, same);
      expect(res.status, s.all(res)).toBe(0);
      expect(s.all(res)).toContain(message('upgrade_current'));
      expect(snap(s)).toEqual(before);
      const low = makeTemplateRelease(s.w, { versions: ['0.0.5'] });
      res = s.upgrade(l, low, ['--to', '0.0.5']);
      expect(res.status, s.all(res)).toBe(1);
      expect(s.all(res)).toContain(message('upgrade_downgrade'));
      expect(snap(s)).toEqual(before);
    });

    it('2b. discovery picks the highest release, never a prerelease, ignores hostile tag names', () => {
      const s = setup(l);
      // 0.1.0 to 0.35.0 in a scrambled order (17 is coprime to 35).
      const versions = Array.from({ length: 35 }, (_, i) => `0.${((i * 17) % 35) + 1}.0`);
      const r = makeTemplateRelease(s.w, {
        versions: [...versions, '9.0.0-rc1'],
        extraTags: ['kit-v1.0.0$(id)'],
      });
      const first = s.upgrade(l, r);
      expect(first.status, s.all(first)).toBe(0);
      const heads = () =>
        git(s.p.origin, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
      expect(heads()).toContain('kit-upgrade/0.35.0');
      expect(heads()).not.toContain('9.0.0-rc1');
      expect(heads()).not.toContain('$(id)');
      const rc = s.upgrade(l, r, ['--to', '9.0.0-rc1']);
      expect(rc.status, s.all(rc)).toBe(0);
      expect(heads()).toContain('kit-upgrade/9.0.0-rc1');
    });

    it('3. a dirty clone, a held session and a held lock are refused', () => {
      const s = setup(l);
      const r = makeTemplateRelease(s.w, { versions: ['0.2.0'] });
      writeFileSync(join(s.p.clone, 'AGENTS.md'), 'edited by hand\n');
      let before = snap(s);
      let res = s.upgrade(l, r);
      expect(res.status, s.all(res)).not.toBe(0);
      expect(s.all(res)).toContain(message('upgrade_dirty'));
      expect(snap(s)).toEqual(before);
      git(s.p.clone, ['checkout', '--', 'AGENTS.md']);
      mkdirSync(join(s.p.stateDir, 'held'));
      writeFileSync(join(s.p.stateDir, 'held', 'info'), 'start=x\n');
      before = snap(s);
      res = s.upgrade(l, r);
      expect(res.status, s.all(res)).not.toBe(0);
      expect(s.all(res)).toContain(message('upgrade_held'));
      expect(snap(s)).toEqual(before);
      mkdirSync(join(s.p.stateDir, 'lock'));
      res = s.upgrade(l, r);
      expect(res.status, s.all(res)).not.toBe(0);
      expect(snap(s)).toEqual(before);
    });

    describe.each(HOSTILE)('4. hostile release: %s', (hostile) => {
      it('is refused and nothing changes', () => {
        const s = setup(l);
        const marker = join(s.w.root, 'hook-ran');
        const r = makeTemplateRelease(s.w, { versions: ['0.2.0'], hostile });
        const before = snap(s);
        const res = s.upgrade(l, r, ['--to', '0.2.0'], { GELDAR_HOOK_MARKER: bashPath(marker) });
        expect(res.status, s.all(res)).not.toBe(0);
        expect(s.all(res)).toContain(message('upgrade_bad_release'));
        expect(snap(s)).toEqual(before);
        expect(existsSync(marker)).toBe(false);
      });
    });

    it('4b. memory and skills named in the release are not copied and not an error', () => {
      const s = setup(l);
      const r = makeTemplateRelease(s.w, { versions: ['0.2.0'], hostile: 'memory-content' });
      const res = s.upgrade(l, r, ['--to', '0.2.0']);
      expect(res.status, s.all(res)).toBe(0);
      const names = git(s.p.origin, ['ls-tree', '-r', '--name-only', 'kit-upgrade/0.2.0']);
      expect(names).not.toContain('smuggled');
    });

    it('5. an existing kit-upgrade branch is refused', () => {
      const s = setup(l);
      const r = makeTemplateRelease(s.w, { versions: ['0.2.0'] });
      git(s.p.clone, ['branch', 'kit-upgrade/0.2.0']);
      const before = snap(s);
      const res = s.upgrade(l, r, ['--to', '0.2.0']);
      expect(res.status, s.all(res)).not.toBe(0);
      expect(s.all(res)).toContain(message('upgrade_branch_exists'));
      expect(snap(s)).toEqual(before);
    });

    it('6. the push is never forced, the player branch never pushed, the clone ends on its branch', () => {
      const s = setup(l);
      const r = makeTemplateRelease(s.w, { versions: ['0.2.0'] });
      let res = s.upgrade(l, r, ['--to', '0.2.0']);
      expect(res.status, s.all(res)).toBe(0);
      const pushes = s.w.gitCalls().filter((c) => c.includes('push'));
      expect(pushes.length).toBeGreaterThan(0);
      for (const c of pushes) {
        const forced = (a: string) =>
          a === '--force' || a === '-f' || a.startsWith('--force-with') || a.startsWith('+');
        expect(c.some(forced)).toBe(false);
        expect(c.some((a) => a === 'main' || a.endsWith(':main') || a.endsWith('/main'))).toBe(
          false,
        );
        expect(c.some((a) => a.includes('kit-upgrade/0.2.0'))).toBe(true);
      }
      expect(branchName(s.p.clone)).toBe('main');
      // Failure paths: the pull request cannot be made, then a refused release.
      const r2 = makeTemplateRelease(s.w, { versions: ['0.3.0'] });
      res = s.upgrade(l, r2, ['--to', '0.3.0'], { FAKE_GH_PR_FAIL: '1' });
      expect(res.status, s.all(res)).not.toBe(0);
      expect(s.all(res)).toContain(message('upgrade_pr_failed'));
      expect(branchName(s.p.clone)).toBe('main');
      expect(git(s.p.clone, ['status', '--porcelain'])).toBe('');
      const bad = makeTemplateRelease(s.w, { versions: ['0.4.0'], hostile: 'symlink' });
      s.upgrade(l, bad, ['--to', '0.4.0']);
      expect(branchName(s.p.clone)).toBe('main');
    });

    it('7. control characters in the pull request URL are stripped', () => {
      const s = setup(l);
      const r = makeTemplateRelease(s.w, { versions: ['0.2.0'] });
      const res = s.upgrade(l, r, ['--to', '0.2.0'], {
        FAKE_GH_PR_URL: 'https://github.test/pull/7\u001b[31m\u0007evil',
      });
      expect(res.status, s.all(res)).toBe(0);
      const out = s.all(res);
      expect(out).toContain('https://github.test/pull/7');
      const controls = [...out].filter((ch) => {
        const c = ch.charCodeAt(0);
        return (c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127;
      });
      expect(controls).toEqual([]);
    });

    timingIt(
      '8. a gh that hangs is bounded and the clone ends on its branch',
      () => {
        const s = setup(l);
        const r = makeTemplateRelease(s.w, { versions: ['0.2.0'] });
        const res = s.upgrade(l, r, ['--to', '0.2.0'], { FAKE_GH_SLEEP: '300' });
        expect(res.status, s.all(res)).not.toBe(0);
        expect(branchName(s.p.clone)).toBe('main');
        expect(git(s.p.clone, ['status', '--porcelain'])).toBe('');
      },
      200_000,
    );

    timingIt(
      '9. a clone that hangs is bounded and nothing changes',
      () => {
        const s = setup(l);
        const r = makeTemplateRelease(s.w, { versions: ['0.2.0'] });
        const before = snap(s);
        const res = s.upgrade(l, r, ['--to', '0.2.0'], {
          FAKE_GIT_SLEEP_ON: 'clone',
          FAKE_GIT_SLEEP_SEC: '300',
        });
        expect(res.status, s.all(res)).not.toBe(0);
        expect(snap(s)).toEqual(before);
      },
      200_000,
    );
  });
}
