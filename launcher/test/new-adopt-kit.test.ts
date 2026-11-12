import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { bashPath, forGroup, git } from './harness.ts';
import { ID, MOCK, newRun, rawCommit, type Setup, setupWorld, useTemplate } from './new-support.ts';

vi.setConfig({ testTimeout: 180_000 });

// The --kit-version option and the tag choice of new --repo (the same rule as upgrade): an exact tag,
// the newest stable tag, or the newest prerelease when no tag is stable.
describe.each(forGroup('new'))('new --repo --kit-version ($name)', (l) => {
  const REPO = 'Acme/other-repo';
  const bareOf = (s: Setup) => join(s.ghRoot, 'other-repo.git');
  const adoptArgs = (extra: string[] = []) => [
    ID,
    '--mock',
    MOCK,
    '--public',
    '--repo',
    REPO,
    ...extra,
  ];
  const bareHead = (s: Setup) => git(bareOf(s), ['rev-parse', 'main']);
  // A players folder that does not exist yet: a refusal must not leave it behind.
  const fresh = (s: Setup) => {
    const p = join(s.w.root, 'fresh-players');
    return { p, env: { GELDAR_PLAYERS_DIR: l.name === 'bash' ? bashPath(p) : p } };
  };

  // The bare Acme/other-repo with one README.md, empty enough for adopt.
  function seedRepo(s: Setup) {
    git(s.w.root, ['init', '-q', '--bare', '-b', 'main', bareOf(s)]);
    const c = rawCommit(bareOf(s), [{ name: 'README.md', mode: '100644', body: 'x\n' }]);
    git(bareOf(s), ['update-ref', 'refs/heads/main', c]);
    writeFileSync(join(s.ghRoot, 'other-repo.vis'), 'public');
  }

  // A template repository with one tagged commit per tag; each commit's README.md says its tag.
  // No tags at all makes a template with no kit-v tag.
  function seedTags(s: Setup, tags: string[]) {
    const dir = join(s.w.root, 'tplkit');
    mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    let head: string | undefined;
    for (const t of tags) {
      head = rawCommit(dir, [{ name: 'README.md', mode: '100644', body: `${t}\n` }], head);
      git(dir, ['tag', `kit-v${t}`, head]);
    }
    if (!head) {
      head = rawCommit(dir, [{ name: 'README.md', mode: '100644', body: 'untagged\n' }]);
      git(dir, ['update-ref', 'refs/heads/main', head]);
    }
    useTemplate(s, dir);
  }
  // The README.md the repository now holds on its main branch: the template's tag name.
  const pushedTag = (s: Setup) => git(bareOf(s), ['show', 'main:README.md']).trim();

  it('K1. --kit-version copies an exact prerelease tag that exists, even when a newer one does too', () => {
    const s = setupWorld();
    seedRepo(s);
    seedTags(s, ['0.1.0-rc5', '0.1.0-rc7']);
    const r = newRun(l, s, adoptArgs(['--kit-version', '0.1.0-rc5']), fresh(s).env);
    expect(r.status, r.stderr).toBe(0);
    expect(pushedTag(s)).toBe('0.1.0-rc5');
  });

  it('K2. without --kit-version the newest prerelease is copied when no tag is stable, rc10 after rc9', () => {
    const s = setupWorld();
    seedRepo(s);
    seedTags(s, ['0.1.0-rc5', '0.1.0-rc9', '0.1.0-rc10']);
    const r = newRun(l, s, adoptArgs(), fresh(s).env);
    expect(r.status, r.stderr).toBe(0);
    expect(pushedTag(s)).toBe('0.1.0-rc10');
  });

  it('K3. a stable tag is copied over a newer prerelease when both exist', () => {
    const s = setupWorld();
    seedRepo(s);
    seedTags(s, ['1.0.0', '1.1.0-rc1']);
    const r = newRun(l, s, adoptArgs(), fresh(s).env);
    expect(r.status, r.stderr).toBe(0);
    expect(pushedTag(s)).toBe('1.0.0');
  });

  it('K4. an unknown --kit-version is refused, nothing created', () => {
    const s = setupWorld();
    seedRepo(s);
    seedTags(s, ['0.1.0-rc5']);
    const before = bareHead(s);
    const r = newRun(l, s, adoptArgs(['--kit-version', '9.9.9']), fresh(s).env);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('no kit version 9.9.9');
    expect(s.ghCalls().some((c) => c[1] === 'clone')).toBe(false);
    expect(existsSync(fresh(s).p)).toBe(false);
    expect(bareHead(s)).toBe(before);
  });

  it('K5. a malformed --kit-version is refused before GitHub is called', () => {
    for (const bad of ['0.1', '01.0.0', '1.0.0-', 'v0.1.0', '0.1.0 rc5']) {
      const s = setupWorld();
      seedRepo(s);
      seedTags(s, ['0.1.0-rc5']);
      const r = newRun(l, s, adoptArgs(['--kit-version', bad]), fresh(s).env);
      expect(r.status, bad).toBe(1);
      expect(r.stderr, bad).toContain('--kit-version value is not allowed');
      expect(s.ghCalls().length, bad).toBe(0);
    }
  });

  it('K6. --kit-version without --repo is refused, nothing created', () => {
    const s = setupWorld();
    seedRepo(s);
    seedTags(s, ['0.1.0-rc5']);
    const r = newRun(
      l,
      s,
      [ID, '--mock', MOCK, '--public', '--kit-version', '0.1.0-rc5'],
      fresh(s).env,
    );
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('--kit-version value is not allowed');
    expect(existsSync(fresh(s).p)).toBe(false);
  });

  it('K7. a second --kit-version is refused', () => {
    const s = setupWorld();
    seedRepo(s);
    seedTags(s, ['0.1.0-rc5', '0.1.0-rc7']);
    const r = newRun(
      l,
      s,
      adoptArgs(['--kit-version', '0.1.0-rc5', '--kit-version', '0.1.0-rc7']),
      fresh(s).env,
    );
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('--kit-version value is not allowed');
    expect(s.ghCalls().some((c) => c[1] === 'clone')).toBe(false);
  });

  it('K8. a template with no kit-v tag at all is still template_unpinned', () => {
    const s = setupWorld();
    seedRepo(s);
    seedTags(s, []);
    const before = bareHead(s);
    const r = newRun(l, s, adoptArgs(), fresh(s).env);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('no released kit version');
    expect(bareHead(s)).toBe(before);
  });
});
