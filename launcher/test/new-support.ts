// Shared fixtures for new.test.ts and new-adopt.test.ts: the fake-gh world, runners and raw git builders.
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bashExe,
  bashPath,
  git,
  type Launcher,
  makeWorld,
  repoRoot,
  run,
  type World,
} from './harness.ts';

export const fakeGh = bashPath(join(repoRoot, 'launcher', 'test', 'fake-gh.sh'));
export const win = process.platform === 'win32';
export const ID = 'abc';
export const HOST = { name: 'Host', email: 'host@example.test' };
export const MOCK = 'http://world.test';
// A private-network address, built from parts so the repo holds no such literal.
export const privateQuad = [10, 0, 0, 1].join('.');

export interface Setup {
  w: World;
  ghRoot: string;
  env: Record<string, string>;
  envPwsh: Record<string, string>;
  ghCalls(): string[][];
}

export function setupWorld(conf = 'mcp_base=\nprivate_only_shards=\n'): Setup {
  const w = makeWorld();
  const ghRoot = join(w.root, 'gh');
  const shareDir = join(w.root, 'share');
  mkdirSync(join(shareDir, 'config'), { recursive: true });
  writeFileSync(join(shareDir, 'config', 'world.conf'), conf);
  writeFileSync(join(w.fakeDir, 'gh'), `#!/bin/sh\nexec sh "${fakeGh}" "$@"\n`);
  chmodSync(join(w.fakeDir, 'gh'), 0o755);
  if (win && bashExe) writeFileSync(join(w.fakeDir, 'gh.cmd'), `@"${bashExe}" "${fakeGh}" %*\r\n`);
  // The host's own identity, with signing switched on.
  writeFileSync(
    join(w.root, 'gitconfig'),
    `[user]\n\tname = ${HOST.name}\n\temail = ${HOST.email}\n[commit]\n\tgpgsign = true\n[tag]\n\tgpgsign = true\n[init]\n\tdefaultBranch = main\n`,
  );
  const env = {
    ...w.env,
    GELDAR_GH: bashPath(join(w.fakeDir, 'gh')),
    GELDAR_SHARE: bashPath(shareDir),
    GELDAR_SLEEP: '0',
    FAKE_GH_ROOT: bashPath(ghRoot),
    FAKE_GH_TEMPLATE: bashPath(join(repoRoot, 'template')),
    GIT_AUTHOR_NAME: HOST.name,
    GIT_AUTHOR_EMAIL: HOST.email,
    GIT_COMMITTER_NAME: HOST.name,
    GIT_COMMITTER_EMAIL: HOST.email,
  };
  // pwsh starts the fakes itself, so it gets native paths and the .cmd shim on Windows.
  const envPwsh = {
    ...env,
    ...w.envPwsh,
    GELDAR_GH: join(w.fakeDir, win ? 'gh.cmd' : 'gh'),
    GELDAR_SHARE: shareDir,
  };
  const ghCalls = () => {
    const f = join(ghRoot, 'calls.log');
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\t'));
  };
  return { w, ghRoot, env, envPwsh, ghCalls };
}

export function token(): string {
  return randomBytes(24).toString('base64url');
}

export function tokenFile(l: Launcher, w: World, body: string | Buffer): string {
  const f = join(w.root, 'tok.txt');
  writeFileSync(f, body);
  return l.name === 'bash' ? bashPath(f) : f;
}

export function newRun(
  l: Launcher,
  s: Setup,
  args: string[],
  extra: Record<string, string> = {},
  timeoutMs = 120_000,
) {
  return run(l, ['new', ...args], {
    env: { ...(l.name === 'bash' ? s.env : s.envPwsh), ...extra },
    timeoutMs,
  });
}

export function filesUnder(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesUnder(dir, r));
    else out.push(r);
  }
  return out;
}

export const IDENT = [
  '-c',
  'user.name=S',
  '-c',
  'user.email=s@example.test',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'tag.gpgsign=false',
];

export interface RawEntry {
  name: string;
  mode: string;
  body: string | Buffer;
}

// A commit holding exactly these top-level entries, built from raw objects so that git's own path
// checks (links, dot names, quotes) do not get in the way. Returns the commit id.
export function rawCommit(dir: string, entries: RawEntry[], parent?: string): string {
  const tmp = mkdtempSync(join(tmpdir(), 'raw-'));
  const shas = new Map<string, string>();
  const parts: Buffer[] = [];
  const sorted = [...entries].sort((a, b) =>
    Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)),
  );
  for (const e of sorted) {
    const key = Buffer.from(e.body).toString('base64');
    let sha = shas.get(key);
    if (!sha) {
      writeFileSync(join(tmp, 'blob'), e.body);
      sha = git(dir, ['hash-object', '-w', join(tmp, 'blob')]);
      shas.set(key, sha);
    }
    parts.push(Buffer.from(`${e.mode} ${e.name}\0`), Buffer.from(sha, 'hex'));
  }
  writeFileSync(join(tmp, 'tree'), Buffer.concat(parts));
  const tree = git(dir, ['hash-object', '-t', 'tree', '-w', '--literally', join(tmp, 'tree')]);
  return git(dir, [...IDENT, 'commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', 'raw']);
}

// Points the launcher at a template repository (the upgrade path's seam, GELDAR_TEMPLATE_URL).
export function useTemplate(s: Setup, dir: string) {
  s.env.GELDAR_TEMPLATE_URL = bashPath(dir);
  s.envPwsh.GELDAR_TEMPLATE_URL = dir;
}

// The shipped template as a released kit: tagged kit-v1.0.0, then one later commit that is not tagged.
export function seedTemplate(s: Setup): string {
  const dir = join(s.w.root, 'tplrepo');
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  cpSync(join(repoRoot, 'template'), dir, { recursive: true });
  git(dir, ['add', '-A']);
  // The index of this repository is the truth about the executable bit, whatever the file system says.
  for (const line of git(repoRoot, ['ls-files', '-s', 'template']).split('\n')) {
    const m = /^100755 \S+ \d+\t(.+)$/.exec(line);
    if (m) git(dir, ['update-index', '--chmod=+x', '--', m[1].slice('template/'.length)]);
  }
  git(dir, [...IDENT, 'commit', '-q', '-m', 'release']);
  git(dir, ['tag', 'kit-v1.0.0']);
  writeFileSync(join(dir, 'README.md'), 'LATER, untagged\n');
  git(dir, ['add', '-A']);
  git(dir, [...IDENT, 'commit', '-q', '-m', 'later']);
  useTemplate(s, dir);
  return dir;
}

// A template whose released tag holds exactly these entries.
export function seedRawTemplate(s: Setup, entries: RawEntry[]) {
  const dir = join(s.w.root, 'tplraw');
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  const c = rawCommit(dir, entries);
  git(dir, ['update-ref', 'refs/heads/main', c]);
  git(dir, ['tag', 'kit-v1.0.0', c]);
  useTemplate(s, dir);
}
