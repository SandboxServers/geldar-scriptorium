import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { bashPath, forGroup, git, repoRoot } from './harness.ts';
import {
  filesUnder,
  ID,
  MOCK,
  newRun,
  type RawEntry,
  rawCommit,
  type Setup,
  seedRawTemplate,
  seedTemplate,
  setupWorld,
  token,
  tokenFile,
} from './new-support.ts';

vi.setConfig({ testTimeout: 180_000 });

describe.each(forGroup('new'))('new --repo and token files ($name)', (l) => {
  const clonePath = (s: Setup) => join(s.w.players, `player-${ID}`);
  // --repo: an existing repository, seeded as the bare Acme/NAME with the given top-level files.
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
  // Seeds the bare Acme/other-repo with the given files (or raw entries) and the pinned template.
  function seedRepo(s: Setup, vis: string, files: Record<string, string> = { 'README.md': 'x\n' }) {
    seedRepoRaw(
      s,
      vis,
      Object.entries(files).map(([name, body]) => ({ name, mode: '100644', body })),
    );
  }
  function seedRepoRaw(s: Setup, vis: string, entries: RawEntry[]) {
    git(s.w.root, ['init', '-q', '--bare', '-b', 'main', bareOf(s)]);
    git(bareOf(s), ['update-ref', 'refs/heads/main', rawCommit(bareOf(s), entries)]);
    writeFileSync(join(s.ghRoot, 'other-repo.vis'), vis);
    seedTemplate(s);
  }
  // A players folder that does not exist yet: a refusal must not leave it behind.
  const fresh = (s: Setup) => {
    const p = join(s.w.root, 'fresh-players');
    return { p, env: { GELDAR_PLAYERS_DIR: l.name === 'bash' ? bashPath(p) : p } };
  };
  const bareHead = (s: Setup) => git(bareOf(s), ['rev-parse', 'main']);

  it('11. --repo fills an empty repository from the template, with the persona', () => {
    const s = setupWorld();
    seedRepo(s, 'public');
    const pdir = join(s.w.root, 'persona');
    mkdirSync(join(pdir, ID, 'memory'), { recursive: true });
    writeFileSync(join(pdir, ID, 'memory', 'identity.md'), '# Identity\n\nA ranger.\n');
    writeFileSync(join(pdir, ID, 'memory', 'goals.md'), '# Goals\n\nProtect.\n');
    const pd = l.name === 'bash' ? bashPath(pdir) : pdir;
    const r = newRun(l, s, adoptArgs(['--persona-dir', pd]));
    expect(r.status, r.stderr).toBe(0);
    const calls = s.ghCalls();
    expect(calls.some((c) => c[1] === 'create')).toBe(false);
    expect(calls.some((c) => c[1] === 'view' && c[2] === REPO)).toBe(true);
    expect(calls.some((c) => c[0] === 'api' && c[1] === `repos/${REPO}/contents`)).toBe(true);
    const tpl = join(repoRoot, 'template');
    const have = filesUnder(clonePath(s));
    for (const f of filesUnder(tpl)) expect(have, f).toContain(f);
    expect(have).toContain('memory/identity.md');
    expect(readFileSync(join(clonePath(s), 'README.md'), 'utf8')).toBe(
      readFileSync(join(tpl, 'README.md'), 'utf8'),
    );
    expect(git(clonePath(s), ['log', '-n', '1', '--format=%s'])).toBe(`player: ${ID}`);
    expect(git(clonePath(s), ['rev-list', '--count', 'HEAD'])).toBe('2');
    expect(git(clonePath(s), ['status', '--porcelain'])).toBe('');
    expect(bareHead(s)).toBe(git(clonePath(s), ['rev-parse', 'HEAD']));
    expect(readFileSync(join(clonePath(s), 'memory', 'identity.md'), 'utf8')).toContain(
      'A ranger.',
    );
  });

  it('12. --repo refuses a visibility mismatch with nothing created', () => {
    const s = setupWorld();
    seedRepo(s, 'private');
    const before = bareHead(s);
    const r = newRun(l, s, adoptArgs(), fresh(s).env);
    expect(r.status, r.stderr).toBe(1);
    expect(existsSync(fresh(s).p)).toBe(false);
    expect(r.stderr).toContain(`${REPO} is private, but public was asked for`);
    expect(s.ghCalls().some((c) => c[1] === 'clone' || c[1] === 'create')).toBe(false);
    expect(existsSync(clonePath(s))).toBe(false);
    expect(bareHead(s)).toBe(before);
  });

  it('13. --repo refuses a repository holding other files', () => {
    const s = setupWorld();
    seedRepo(s, 'public', { 'README.md': 'x\n', 'src/a.txt': 'a\n' });
    const r = newRun(l, s, adoptArgs(), fresh(s).env);
    expect(r.status, r.stderr).toBe(1);
    expect(existsSync(fresh(s).p)).toBe(false);
    expect(r.stderr).toContain('must hold only README.md, LICENSE and .gitignore');
    expect(s.ghCalls().some((c) => c[1] === 'clone')).toBe(false);
    expect(existsSync(clonePath(s))).toBe(false);
  });

  it('14. --repo refuses a repository that is not there, and a bad value', () => {
    const s = setupWorld();
    const r = newRun(l, s, adoptArgs(), fresh(s).env);
    expect(r.status, r.stderr).toBe(1);
    expect(existsSync(fresh(s).p)).toBe(false);
    expect(r.stderr).toContain('was not found');
    const b = newRun(l, s, [ID, '--mock', MOCK, '--public', '--repo', 'no/such/thing']);
    expect(b.status, b.stderr).toBe(1);
    expect(b.stderr).toContain('--repo value is not allowed');
    expect(existsSync(clonePath(s))).toBe(false);
  });

  it('15. --repo refuses a template that holds a symlink', () => {
    const s = setupWorld();
    seedRepo(s, 'public');
    seedRawTemplate(s, [
      { name: 'README.md', mode: '100644', body: 'r\n' },
      { name: 'link', mode: '120000', body: 'README.md' },
    ]);
    const before = bareHead(s);
    const r = newRun(l, s, adoptArgs(), fresh(s).env);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('may already hold the first commit for abc (template)');
    expect(r.stderr).not.toContain('already made on GitHub');
    expect(existsSync(join(fresh(s).p, `player-${ID}`))).toBe(false);
    expect(existsSync(join(s.w.state, ID))).toBe(false);
    expect(bareHead(s)).toBe(before);
  });

  it('15b. --repo refuses a template path of .., .GIT or a case variant of .git', () => {
    for (const name of ['..', '.GIT', '.Git']) {
      const s = setupWorld();
      seedRepo(s, 'public');
      seedRawTemplate(s, [
        { name: 'README.md', mode: '100644', body: 'r\n' },
        { name, mode: '100644', body: 'x\n' },
      ]);
      const before = bareHead(s);
      const r = newRun(l, s, adoptArgs());
      expect(r.status, `${name}: ${r.stderr}`).toBe(1);
      expect(r.stderr).toContain('(template)');
      expect(existsSync(clonePath(s))).toBe(false);
      expect(bareHead(s)).toBe(before);
    }
  });

  it('15c. --repo refuses a template of more than 2000 files, and one of more than 20 MB', () => {
    const many: RawEntry[] = [];
    for (let i = 0; i <= 2000; i++) many.push({ name: `f${i}`, mode: '100644', body: 'x\n' });
    const big = [{ name: 'big', mode: '100644', body: Buffer.alloc(21 * 1024 * 1024, 97) }];
    for (const entries of [many, big]) {
      const s = setupWorld();
      seedRepo(s, 'public');
      seedRawTemplate(s, entries);
      const before = bareHead(s);
      const r = newRun(l, s, adoptArgs(), fresh(s).env);
      expect(r.status, r.stderr).toBe(1);
      expect(r.stderr).toContain('more than 2000 files or 20 MB');
      expect(existsSync(fresh(s).p)).toBe(false);
      expect(existsSync(join(s.w.state, ID))).toBe(false);
      expect(bareHead(s)).toBe(before);
    }
  });

  it('18. --repo copies the tagged template, not a later untagged commit', () => {
    const s = setupWorld();
    seedRepo(s, 'public');
    const r = newRun(l, s, adoptArgs());
    expect(r.status, r.stderr).toBe(0);
    const readme = readFileSync(join(clonePath(s), 'README.md'), 'utf8');
    expect(readme).not.toContain('LATER');
    expect(readme).toBe(readFileSync(join(repoRoot, 'template', 'README.md'), 'utf8'));
    expect(git(bareOf(s), ['show', 'main:README.md'])).not.toContain('LATER');
  });

  it('19. --repo with no released template tag is refused: template_unpinned, nothing changed', () => {
    const s = setupWorld();
    seedRepo(s, 'public');
    git(join(s.w.root, 'tplrepo'), ['tag', '-d', 'kit-v1.0.0']);
    const before = bareHead(s);
    const r = newRun(l, s, adoptArgs(), fresh(s).env);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('no released kit version');
    expect(s.ghCalls().some((c) => c[1] === 'clone')).toBe(false);
    expect(existsSync(fresh(s).p)).toBe(false);
    expect(bareHead(s)).toBe(before);
  });

  it('20. --repo refuses a repository whose README.md is a link; nothing outside changes', () => {
    const s = setupWorld();
    const outside = join(s.w.root, 'outside.txt');
    writeFileSync(outside, 'keep\n');
    seedRepoRaw(s, 'public', [{ name: 'README.md', mode: '120000', body: bashPath(outside) }]);
    const before = bareHead(s);
    const r = newRun(l, s, adoptArgs(), fresh(s).env);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('must hold only README.md, LICENSE and .gitignore');
    expect(readFileSync(outside, 'utf8')).toBe('keep\n');
    expect(existsSync(fresh(s).p)).toBe(false);
    expect(existsSync(join(s.w.state, ID))).toBe(false);
    expect(bareHead(s)).toBe(before);
  });

  it('21. the copy removes a file that appears in the clone after the check', () => {
    const s = setupWorld();
    seedRepo(s, 'public');
    const outside = join(s.w.root, 'outside.txt');
    writeFileSync(outside, 'keep\n');
    const r = newRun(l, s, adoptArgs(), { FAKE_GH_RACE_LINK: bashPath(outside) });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(outside, 'utf8')).toBe('keep\n');
    expect(readFileSync(join(clonePath(s), 'README.md'), 'utf8')).toBe(
      readFileSync(join(repoRoot, 'template', 'README.md'), 'utf8'),
    );
  });

  it('22. the pushed commit keeps the executable hooks at mode 100755', () => {
    const s = setupWorld();
    seedRepo(s, 'public');
    const r = newRun(l, s, adoptArgs());
    expect(r.status, r.stderr).toBe(0);
    const want = git(repoRoot, ['ls-files', '-s', 'template/.claude/hooks'])
      .split('\n')
      .map((x) => /^100755 \S+ \d+\ttemplate\/(.+\.sh)$/.exec(x)?.[1])
      .filter((x): x is string => !!x);
    expect(want.length).toBeGreaterThan(0);
    const have = git(bareOf(s), ['ls-tree', '-r', 'main']).split('\n');
    for (const p of want) {
      expect(
        have.find((x) => x.endsWith(`\t${p}`)),
        p,
      ).toMatch(/^100755 /);
    }
  });

  it('23. a push the remote rejects ends adopt_failed; clone and state are gone', () => {
    const s = setupWorld();
    seedRepo(s, 'public');
    const hook = join(bareOf(s), 'hooks', 'pre-receive');
    writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    chmodSync(hook, 0o755);
    const before = bareHead(s);
    const r = newRun(l, s, adoptArgs());
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain(
      `The repository ${REPO} may already hold the first commit for abc (push)`,
    );
    expect(r.stderr).not.toContain('did not create the repository');
    expect(r.stderr).not.toContain('already made on GitHub');
    expect(existsSync(clonePath(s))).toBe(false);
    expect(existsSync(join(s.w.state, ID))).toBe(false);
    expect(bareHead(s)).toBe(before);
  });

  it('24. an empty contents list, a failing one and a repository with no commit are refused', () => {
    for (const mode of ['empty', 'error', 'nocommit']) {
      const s = setupWorld();
      if (mode === 'nocommit') {
        git(s.w.root, ['init', '-q', '--bare', '-b', 'main', bareOf(s)]);
        writeFileSync(join(s.ghRoot, 'other-repo.vis'), 'public');
        seedTemplate(s);
      } else {
        seedRepo(s, 'public');
      }
      const extra = mode === 'nocommit' ? {} : { FAKE_GH_API: mode };
      const r = newRun(l, s, adoptArgs(), { ...fresh(s).env, ...extra });
      expect(r.status, `${mode}: ${r.stderr}`).toBe(1);
      expect(r.stderr).toContain('must hold only README.md, LICENSE and .gitignore');
      expect(s.ghCalls().some((c) => c[1] === 'clone')).toBe(false);
      expect(existsSync(fresh(s).p)).toBe(false);
    }
  });

  it('25. a second --repo is refused', () => {
    const s = setupWorld();
    seedRepo(s, 'public');
    const r = newRun(l, s, adoptArgs(['--repo', REPO]), fresh(s).env);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('--repo value is not allowed');
    expect(s.ghCalls()).toEqual([]);
    expect(existsSync(fresh(s).p)).toBe(false);
  });

  it('26. a file name with a quote in the repository is refused (the list is escaped JSON)', () => {
    const s = setupWorld();
    seedRepoRaw(s, 'public', [
      { name: 'README.md', mode: '100644', body: 'x\n' },
      { name: 'a"b', mode: '100644', body: 'x\n' },
    ]);
    const r = newRun(l, s, adoptArgs(), fresh(s).env);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('must hold only README.md, LICENSE and .gitignore');
    expect(existsSync(fresh(s).p)).toBe(false);
  });

  it('16. a token file may carry the GELDAR_MCP_TOKEN= prefix; other prefixes are refused', () => {
    const t = token();
    const s = setupWorld();
    const a = newRun(l, s, [
      ID,
      '--mock',
      MOCK,
      '--token-file',
      tokenFile(l, s.w, `GELDAR_MCP_TOKEN=${t}\n`),
    ]);
    expect(a.status, a.stderr).toBe(0);
    expect(readFileSync(join(s.w.state, ID, 'token'), 'utf8').trim()).toBe(t);
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    for (const body of [
      `OTHER_TOKEN=${t}\n`,
      `GELDAR_MCP_TOKEN=GELDAR_MCP_TOKEN=${t}\n`,
      'GELDAR_MCP_TOKEN=short\n',
      Buffer.concat([bom, Buffer.from(`GELDAR_MCP_TOKEN=${t}\n`)]),
      Buffer.concat([bom, Buffer.from(`${t}\n`)]),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${t}\n`, 'utf16le')]),
      Buffer.from(`${t}\n`, 'utf16le'),
    ]) {
      const s2 = setupWorld();
      const b = newRun(l, s2, [ID, '--mock', MOCK, '--token-file', tokenFile(l, s2.w, body)]);
      expect(b.status, b.stderr).toBe(1);
      expect(b.stderr).toContain('token file is not valid');
      expect(s2.ghCalls()).toEqual([]);
    }
  });
});
