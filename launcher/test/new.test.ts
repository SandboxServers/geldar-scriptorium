import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bashPath,
  forGroup,
  git,
  type Launcher,
  makeWorld,
  repoRoot,
  run,
  type World,
} from './harness.ts';
import { timingIt } from './timing.ts';

vi.setConfig({ testTimeout: 180_000 });

const fakeGh = bashPath(join(repoRoot, 'launcher', 'test', 'fake-gh.sh'));
const win = process.platform === 'win32';
const ID = 'abc';
const HOST = { name: 'Host', email: 'host@example.test' };
const MOCK = 'http://world.test';

interface Setup {
  w: World;
  ghRoot: string;
  env: Record<string, string>;
  ghCalls(): string[][];
}

function setupWorld(conf = 'mcp_base=\nprivate_only_shards=\n'): Setup {
  const w = makeWorld();
  const ghRoot = join(w.root, 'gh');
  const shareDir = join(w.root, 'share');
  mkdirSync(join(shareDir, 'config'), { recursive: true });
  writeFileSync(join(shareDir, 'config', 'world.conf'), conf);
  writeFileSync(join(w.fakeDir, 'gh'), `#!/bin/sh\nexec sh "${fakeGh}" "$@"\n`);
  chmodSync(join(w.fakeDir, 'gh'), 0o755);
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
  const ghCalls = () => {
    const f = join(ghRoot, 'calls.log');
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\t'));
  };
  return { w, ghRoot, env, ghCalls };
}

function token(): string {
  return randomBytes(24).toString('base64url');
}

function tokenFile(w: World, body: string): string {
  const f = join(w.root, 'tok.txt');
  writeFileSync(f, body);
  return bashPath(f);
}

function newRun(
  l: Launcher,
  s: Setup,
  args: string[],
  extra: Record<string, string> = {},
  timeoutMs = 120_000,
) {
  return run(l, ['new', ...args], { env: { ...s.env, ...extra }, timeoutMs });
}

function filesUnder(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesUnder(dir, r));
    else out.push(r);
  }
  return out;
}

describe.each(forGroup('new'))('new ($name)', (l) => {
  const clonePath = (s: Setup) => join(s.w.players, `player-${ID}`);

  it('1. happy path with --mock: repo, player.json, clone and origin', () => {
    const s = setupWorld();
    const r = newRun(l, s, [ID, '--mock', MOCK]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain(`Created ${ID}. Next: geldar-play setup ${ID}`);
    const pj = JSON.parse(readFileSync(join(clonePath(s), 'player.json'), 'utf8'));
    expect(pj.mcp_url).toBe(`${MOCK}/p/${ID}`);
    expect(pj.player_id).toBe(ID);
    expect(pj.shard).toBe('commons');
    expect(pj.harness).toBe('claude');
    const bare = join(s.ghRoot, `player-${ID}.git`);
    expect(git(clonePath(s), ['remote', 'get-url', 'origin'])).toContain(`player-${ID}.git`);
    expect(git(bare, ['rev-parse', 'main'])).toBe(git(clonePath(s), ['rev-parse', 'HEAD']));
    expect(readFileSync(join(s.w.state, ID, 'clone'), 'utf8').trim()).toContain(`player-${ID}`);
    expect(readFileSync(join(s.w.state, ID, 'branch'), 'utf8').trim()).toBe('main');
  });

  it('2. commits carry the player identity, never the host identity or a signature', () => {
    const s = setupWorld();
    const r = newRun(l, s, [ID, '--mock', MOCK]);
    expect(r.status, r.stderr).toBe(0);
    const who = git(clonePath(s), ['log', '--format=%an <%ae> %cn <%ce>', '-n', '1']);
    const me = `player-${ID} <player-${ID}@users.noreply.github.com>`;
    expect(who).toBe(`${me} ${me}`);
    const all = git(clonePath(s), ['log', '--all', '--format=%an%ae%cn%ce']);
    expect(all).not.toContain('Host');
    expect(all).not.toContain('host@example.test');
    expect(git(clonePath(s), ['log', '-n', '1', '--format=%G?'])).toBe('N');
    expect(git(clonePath(s), ['log', '-n', '1', '--format=%s'])).toBe(`player: ${ID}`);
  });

  it('3. --private passes --private; the default passes --public and prints the notice', () => {
    const s = setupWorld();
    const a = newRun(l, s, [ID, '--mock', MOCK, '--private']);
    expect(a.status, a.stderr).toBe(0);
    expect(a.stderr).not.toContain('is public');
    const create = s.ghCalls().find((c) => c[1] === 'create') ?? [];
    expect(create).toContain('--private');
    expect(create).not.toContain('--public');
    const s2 = setupWorld();
    const b = newRun(l, s2, [ID, '--mock', MOCK]);
    expect(b.status, b.stderr).toBe(0);
    expect(b.stderr).toContain('repository is public, including its memory.');
    const create2 = s2.ghCalls().find((c) => c[1] === 'create') ?? [];
    expect(create2).toContain('--public');
  });

  it('4. a private-only shard without --private refuses, even with --public', () => {
    const s = setupWorld();
    const hook = { GELDAR_PRIVATE_SHARDS_TEST: 'vault,deep' };
    const a = newRun(l, s, [ID, '--mock', MOCK, '--shard', 'vault'], hook);
    expect(a.status, a.stderr).toBe(1);
    expect(a.stderr).toContain('needs a private repository');
    const c = newRun(l, s, [ID, '--mock', MOCK, '--shard', 'vault', '--public'], hook);
    expect(c.status, c.stderr).toBe(1);
    expect(s.ghCalls()).toEqual([]);
    const b = newRun(l, s, [ID, '--mock', MOCK, '--shard', 'vault', '--private'], hook);
    expect(b.status, b.stderr).toBe(0);
  });

  it('5. the token is stored 0600 and appears nowhere else', () => {
    const s = setupWorld();
    const t = token();
    const tf = tokenFile(s.w, `${t}\n`);
    const r = newRun(l, s, [ID, '--mock', MOCK, '--token-file', tf]);
    expect(r.status, r.stderr).toBe(0);
    const f = join(s.w.state, ID, 'token');
    expect(readFileSync(f, 'utf8').trim()).toBe(t);
    if (!win) expect(statSync(f).mode & 0o777).toBe(0o600);
    for (const rel of filesUnder(clonePath(s))) {
      expect(readFileSync(join(clonePath(s), rel), 'utf8')).not.toContain(t);
    }
    expect(git(clonePath(s), ['log', '--all', '-p'])).not.toContain(t);
    expect(readFileSync(join(s.ghRoot, 'calls.log'), 'utf8')).not.toContain(t);
    expect(s.w.gitCalls().flat().join(' ')).not.toContain(t);
    expect(s.w.calls().flat().join(' ')).not.toContain(t);
  });

  it('6. hostile inputs are refused before any gh call', () => {
    const s = setupWorld();
    const good = token();
    const tf = (body: string) => tokenFile(s.w, body);
    const cases: [string[], number, string][] = [
      [['Bad_Id', '--mock', MOCK], 2, ''],
      [[ID, '--mock', MOCK, '--shard', 'X'], 1, 'shard name is not allowed'],
      [[ID, '--mock', 'http://u:p@h'], 1, 'world address is not allowed'],
      [[ID, '--mock', 'http://h/path'], 1, 'world address is not allowed'],
      [[ID, '--mock', 'http://10.0.0.1'], 1, 'world address is not allowed'],
      [[ID, '--mock', 'ftp://world.test'], 1, 'world address is not allowed'],
      [[ID, '--mock', MOCK, '--token-file', tf('short\n')], 1, 'token file is not valid'],
      [
        [ID, '--mock', MOCK, '--token-file', tf(`${good}\n${good}\n`)],
        1,
        'token file is not valid',
      ],
    ];
    for (const [args, status, text] of cases) {
      const r = newRun(l, s, args);
      expect(r.status, `${args.join(' ')}: ${r.stderr}`).toBe(status);
      expect(r.stderr).toContain(text);
    }
    expect(s.ghCalls()).toEqual([]);
    expect(existsSync(join(s.w.state, ID))).toBe(false);
  });

  it('7a. a clone that fails once is retried', () => {
    const s = setupWorld();
    const r = newRun(l, s, [ID, '--mock', MOCK], { FAKE_GH_CLONE_FAILS: '1' });
    expect(r.status, r.stderr).toBe(0);
    expect(s.ghCalls().filter((c) => c[1] === 'clone').length).toBe(2);
  });

  timingIt('7b. five failed clones end clone_timeout, bounded', () => {
    const s = setupWorld();
    const t0 = Date.now();
    const r = newRun(l, s, [ID, '--mock', MOCK], { FAKE_GH_CLONE_FAILS: '9' });
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('did not finish making the repository');
    expect(s.ghCalls().filter((c) => c[1] === 'clone').length).toBe(5);
    expect(existsSync(join(s.w.state, ID, 'clone'))).toBe(false);
  });

  it('8. blank world: no_world; blank private list is announced; codex refuses', () => {
    const s = setupWorld();
    const a = newRun(l, s, [ID]);
    expect(a.status, a.stderr).toBe(1);
    expect(a.stderr).toContain('No world address is set');
    const b = newRun(l, s, [ID, '--mock', MOCK]);
    expect(b.status, b.stderr).toBe(0);
    expect(b.stderr).toContain('list of private-only shards is not set');
    const c = newRun(l, s, ['--cli', 'codex', 'other', '--mock', MOCK]);
    expect(c.status).not.toBe(0);
    expect(existsSync(join(s.w.players, 'player-other'))).toBe(false);
  });

  it('9. a blank private list and no flag refuses; --public proceeds', () => {
    const s = setupWorld('mcp_base=https://world.test\nprivate_only_shards=\n');
    const a = newRun(l, s, [ID]);
    expect(a.status, a.stderr).toBe(1);
    expect(a.stderr).toContain('list of private-only shards is not set');
    expect(a.stderr).toContain('needs a private repository');
    expect(s.ghCalls()).toEqual([]);
    const b = newRun(l, s, [ID, '--public']);
    expect(b.status, b.stderr).toBe(0);
    const pj = JSON.parse(readFileSync(join(clonePath(s), 'player.json'), 'utf8'));
    expect(pj.mcp_url).toBe(`https://world.test/p/${ID}`);
    expect(s.ghCalls().find((c) => c[1] === 'create')).toContain('--public');
  });

  timingIt('10. a gh that hangs is bounded and leaves nothing local', () => {
    const s = setupWorld();
    const t0 = Date.now();
    const r = newRun(
      l,
      s,
      [ID, '--mock', MOCK],
      { FAKE_GH_SLEEP: '30', GELDAR_HELPER_TIMEOUT_SEC: '2' },
      60_000,
    );
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('did not create the repository');
    expect(existsSync(clonePath(s))).toBe(false);
    expect(existsSync(join(s.w.state, ID))).toBe(false);
  });
});
