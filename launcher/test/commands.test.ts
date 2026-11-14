import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bashExe,
  bashPath,
  childEnv,
  forGroup,
  git,
  type Launcher,
  makePlayer,
  makeWorld,
  repoRoot,
  run,
  type World,
} from './harness.ts';

vi.setConfig({ testTimeout: 180_000 });

const share = bashPath(join(repoRoot, 'image'));
const fakeGh = bashPath(join(repoRoot, 'launcher', 'test', 'fake-gh.sh'));
const gitCli = bashPath(join(repoRoot, 'packages', 'git', 'src', 'cli.ts'));
const ID = 'abc';
const ANSI = String.fromCharCode(27);

const asPlayer = (id: string) =>
  `export GIT_AUTHOR_NAME=player-${id} GIT_AUTHOR_EMAIL=player-${id}@users.noreply.github.com
export GIT_COMMITTER_NAME=player-${id} GIT_COMMITTER_EMAIL=player-${id}@users.noreply.github.com
`;

const benign = `mkdir -p memory/journal
echo hello > memory/journal/day-001.md
node ${gitCli} commit --root . --message "day one" --mode play
`;

// A second clone pushes a commit to origin from inside the session.
const moveOrigin = `OTHER=$(mktemp -d)
git clone -q __ORIGIN__ "$OTHER/o"
(cd "$OTHER/o" && echo other > memory/other.md && git add -A && git commit -q -m other && git push -q origin main)
`;

// The fake gh as each launcher names it: pwsh on Windows runs a .cmd shim around the sh script.
function ghFor(l: Launcher, w: World): string {
  if (l.name === 'bash') return bashPath(join(w.fakeDir, 'gh'));
  if (process.platform !== 'win32') return join(w.fakeDir, 'gh');
  const cmd = join(w.fakeDir, 'gh.cmd');
  if (!existsSync(cmd)) writeFileSync(cmd, `@"${bashExe}" "${fakeGh}" %*\r\n`);
  return cmd;
}

function prep(l: Launcher, w: World, script = benign, id = ID, extra: Record<string, string> = {}) {
  const p = makePlayer(w, { id });
  const sf = join(w.root, `session-${id}.sh`);
  writeFileSync(
    sf,
    `${asPlayer(id)}${script.replaceAll('__ORIGIN__', bashPath(p.origin)).replaceAll('__CLONE__', bashPath(p.clone))}`,
  );
  const ghRoot = join(w.root, 'gh');
  writeFileSync(join(w.fakeDir, 'gh'), `#!/bin/sh\nexec sh "${fakeGh}" "$@"\n`);
  chmodSync(join(w.fakeDir, 'gh'), 0o755);
  const gh = ghFor(l, w);
  const env = {
    ...(l.name === 'bash' ? w.env : w.envPwsh),
    GELDAR_SHARE: share,
    GELDAR_GH: gh,
    FAKE_GH_ROOT: bashPath(ghRoot),
    FAKE_SESSION: bashPath(sf),
    ...extra,
  };
  const go = (args: string[], input?: string) => run(l, args, { env, input, timeoutMs: 150_000 });
  const ghArchives = () => {
    const f = join(ghRoot, 'calls.log');
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8')
      .split('\n')
      .filter((x) => x.includes('archive'));
  };
  return { p, env, go, ghArchives, start: git(p.clone, ['rev-parse', 'HEAD']) };
}

const blockOrigin = (origin: string) => {
  const hook = join(origin, 'hooks', 'pre-receive');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  chmodSync(hook, 0o755);
};
const unblockOrigin = (origin: string) => rmSync(join(origin, 'hooks', 'pre-receive'));
const tip = (dir: string) => git(dir, ['rev-parse', 'main']);
const volDir = (w: World) => join(w.dockerRoot, 'vol', `geldar-ws-${ID}`);
const dockerRuns = (w: World) =>
  w
    .calls()
    .filter(
      (c) => c[0] === 'run' || c[0] === 'volume' || (c[0] === 'compose' && c.includes('run')),
    );

// Makes origin's URL look like a GitHub player repository while fetches still reach the fake.
function githubOrigin(w: World, origin: string, clone: string, url: string) {
  appendFileSync(
    join(w.root, 'gitconfig'),
    `[url "${origin.replace(/\\/g, '/')}"]\n\tinsteadOf = ${url}\n`,
  );
  git(clone, ['config', 'remote.origin.url', url], {
    GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig'),
  });
}

describe.each(forGroup('commands'))('resolve, archive, status ($name)', (l) => {
  it('1. a held push failure: fix the hook, resolve pushes and cleans up', () => {
    const w = makeWorld();
    const { p, go, start } = prep(l, w);
    blockOrigin(p.origin);
    expect(go(['play', ID]).status).toBe(3);
    unblockOrigin(p.origin);
    const r = go(['resolve', ID]);
    expect(r.status, r.stderr).toBe(0);
    expect(tip(p.origin)).not.toBe(start);
    expect(tip(p.clone)).toBe(tip(p.origin));
    expect(existsSync(join(p.stateDir, 'held'))).toBe(false);
    expect(existsSync(join(p.stateDir, 'session'))).toBe(false);
    expect(existsSync(volDir(w))).toBe(false);
  });

  it('2. origin moved: resolve_diverged, exit 3, held intact, never merged', () => {
    const w = makeWorld();
    const { p, go, start } = prep(l, w, moveOrigin + benign);
    expect(go(['play', ID]).status).toBe(3);
    const r = go(['resolve', ID]);
    expect(r.status, r.stderr).toBe(3);
    expect(r.stderr).toContain('origin has moved on');
    expect(existsSync(join(p.stateDir, 'held', 'bundle.bundle'))).toBe(true);
    expect(existsSync(volDir(w))).toBe(true);
    expect(tip(p.clone)).toBe(start);
    expect(w.gitCalls().some((c) => c.includes('merge') && !c.includes('--ff-only'))).toBe(false);
  });

  it('3. resolve --discard drops the volume, bundle and state; play works after', () => {
    const w = makeWorld();
    const { p, go } = prep(l, w);
    blockOrigin(p.origin);
    expect(go(['play', ID]).status).toBe(3);
    const r = go(['resolve', ID, '--discard']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('Dropped the held session for abc (1 commit(s) lost)');
    for (const f of ['held', 'session', 'start', 'mode']) {
      expect(existsSync(join(p.stateDir, f))).toBe(false);
    }
    expect(existsSync(volDir(w))).toBe(false);
    unblockOrigin(p.origin);
    const again = go(['play', ID]);
    expect(again.status, again.stderr).toBe(0);
    expect(tip(p.origin)).toBe(tip(p.clone));
  });

  it('4. nothing held: exit 1 resolve_nothing', () => {
    const w = makeWorld();
    const { go } = prep(l, w);
    const r = go(['resolve', ID]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Nothing is held for abc.');
  });

  describe('5. archive', () => {
    const url = `https://github.com/owner/player-${ID}.git`;
    it.each(['claude', 'chatgpt'])(
      'refuses without the typed line, archives %s with it, removes state and both vendor homes',
      (harness) => {
        const w = makeWorld();
        const { p, go, ghArchives } = prep(l, w);
        if (harness === 'chatgpt') {
          const file = join(p.clone, 'player.json');
          const player = JSON.parse(readFileSync(file, 'utf8'));
          player.harness = harness;
          writeFileSync(file, `${JSON.stringify(player, null, 2)}\n`);
          git(p.clone, [
            '-c',
            'commit.gpgsign=false',
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.test',
            'commit',
            '-am',
            'select ChatGPT',
          ]);
          git(p.clone, ['push', 'origin', 'main']);
        }
        githubOrigin(w, p.origin, p.clone, url);
        for (const input of ['', 'yes\n', 'archive other\n']) {
          const r = go(['archive', ID], input);
          expect(r.status, r.stderr).toBe(1);
          expect(r.stderr).toContain('Type exactly: archive abc');
        }
        expect(ghArchives()).toEqual([]);
        expect(existsSync(p.stateDir)).toBe(true);
        const ok = go(['archive', ID], `archive ${ID}\n`);
        expect(ok.status, ok.stderr).toBe(0);
        expect(ghArchives()).toHaveLength(1);
        expect(ghArchives()[0]).toBe('repo\tarchive\towner/player-abc\t--yes');
        expect(existsSync(p.stateDir)).toBe(false);
        const vols = w.calls().filter((c) => c[0] === 'volume' && c[1] === 'rm');
        expect(vols.map((c) => c[2])).toContain(`geldar-cli-${ID}-claude`);
        expect(vols.map((c) => c[2])).toContain(`geldar-cli-${ID}-chatgpt`);
      },
    );

    it('an unpushed commit: not_pushed and no gh call', () => {
      const w = makeWorld();
      const { p, go, ghArchives } = prep(l, w);
      githubOrigin(w, p.origin, p.clone, url);
      writeFileSync(join(p.clone, 'memory', 'x.md'), 'x\n');
      const g = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
      git(p.clone, ['add', '-A'], g);
      git(p.clone, ['commit', '-m', 'local'], g);
      const r = go(['archive', ID], `archive ${ID}\n`);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('not the same as GitHub');
      expect(ghArchives()).toEqual([]);
      expect(existsSync(p.stateDir)).toBe(true);
    });
  });

  it('6. status prints exact tab-separated lines, no ANSI, no pull', () => {
    const w = makeWorld();
    const a = prep(l, w, benign, 'rdy');
    const born = join(a.p.clone, 'memory', 'identity.md');
    writeFileSync(born, '# Identity\n\nI am Rdy.\n');
    const g = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
    git(a.p.clone, ['add', '-A'], g);
    git(a.p.clone, ['commit', '-m', 'born'], g);
    makePlayer(w, { id: 'unb' });
    const h = makePlayer(w, { id: 'hld' });
    mkdirSync(join(h.stateDir, 'held'), { recursive: true });
    writeFileSync(join(h.stateDir, 'held', 'info'), 'reason=push_failed\nstart=x\nmode=play\n');
    const u = makePlayer(w, { id: 'unf' });
    mkdirSync(join(u.stateDir, 'session'), { recursive: true });
    writeFileSync(join(u.stateDir, 'session', 'running'), '1\n');
    const r = a.go(['status', 'rdy', 'unb', 'hld', 'unf', 'ghost']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(
      'rdy\tready\tmain\nunb\tunborn\tmain\nhld\theld\tmain\tpush_failed\nunf\tunfinished\tmain\nghost\tmissing\n',
    );
    expect(r.stdout).not.toContain(ANSI);
    expect(w.gitCalls().some((c) => c.includes('pull') || c.includes('fetch'))).toBe(false);
    const all = a.go(['status']);
    expect(all.stdout.split('\n').filter(Boolean)).toHaveLength(4);
    const running = run(l, ['status', 'unf'], {
      env: { ...a.env, FAKE_PS_OUTPUT: 'cid1' },
    });
    expect(running.stdout).toBe('unf\trunning\tmain\n');
  });

  it('7. ff_failed hold, then resolve completes without resolve_diverged', () => {
    const w = makeWorld();
    const { p, go } = prep(l, w, benign, ID, { GELDAR_TEST_FORCE_FF_FAIL: '1' });
    const first = go(['play', ID]);
    expect(first.status, first.stderr).toBe(3);
    expect(existsSync(join(p.stateDir, 'held', 'info'))).toBe(true);
    expect(tip(p.origin)).not.toBe(tip(p.clone));
    const r = run(l, ['resolve', ID], {
      env: {
        ...(l.name === 'bash' ? w.env : w.envPwsh),
        GELDAR_SHARE: share,
        GELDAR_GH: ghFor(l, w),
      },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain('moved on');
    expect(tip(p.clone)).toBe(tip(p.origin));
    expect(existsSync(join(p.stateDir, 'held'))).toBe(false);
    expect(existsSync(volDir(w))).toBe(false);
  });

  it('8. a leftover volume from a crashed init: play recreates it, --discard clears it', () => {
    const w = makeWorld();
    const { p, go } = prep(l, w);
    mkdirSync(volDir(w), { recursive: true });
    writeFileSync(join(p.stateDir, 'start'), `${'a'.repeat(40)}\n`);
    const d = go(['resolve', ID, '--discard']);
    expect(d.status, d.stderr).toBe(0);
    expect(existsSync(volDir(w))).toBe(false);
    expect(existsSync(join(p.stateDir, 'start'))).toBe(false);
    mkdirSync(volDir(w), { recursive: true });
    const r = go(['play', ID]);
    expect(r.status, r.stderr).toBe(0);
    expect(tip(p.origin)).toBe(tip(p.clone));
  });

  it('9. archive target and held guards; resolve on a dirty clone', () => {
    const w = makeWorld();
    const { p, go, ghArchives } = prep(l, w);
    const line = `archive ${ID}\n`;
    githubOrigin(w, p.origin, p.clone, 'https://github.com/owner/player-other.git');
    expect(go(['archive', ID], line).stderr).toContain('not a player repository on GitHub');
    git(p.clone, ['config', 'remote.origin.url', 'https://evil.test/owner/player-abc.git']);
    expect(go(['archive', ID], line).status).toBe(1);
    git(p.clone, ['config', 'remote.origin.url', 'https://github.com/owner/player-abc.git.evil']);
    expect(go(['archive', ID], line).stderr).toContain('not a player repository on GitHub');
    mkdirSync(join(p.stateDir, 'held'), { recursive: true });
    expect(go(['archive', ID], line).stderr).toContain('held or unfinished');
    rmSync(join(p.stateDir, 'held'), { recursive: true });
    mkdirSync(join(p.stateDir, 'session'), { recursive: true });
    writeFileSync(join(p.stateDir, 'session', 'running'), '1\n');
    expect(go(['archive', ID], line).stderr).toContain('held or unfinished');
    expect(ghArchives()).toEqual([]);

    const w2 = makeWorld();
    const t = prep(l, w2);
    blockOrigin(t.p.origin);
    expect(t.go(['play', ID]).status).toBe(3);
    writeFileSync(join(t.p.clone, 'dirty.txt'), 'x\n');
    const r = t.go(['resolve', ID]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('has changes that are not saved');
    expect(existsSync(join(t.p.stateDir, 'held', 'bundle.bundle'))).toBe(true);
  });

  it('10. play and setup refuse while held, before any docker call', () => {
    const w = makeWorld();
    const { p, go } = prep(l, w);
    blockOrigin(p.origin);
    expect(go(['play', ID]).status).toBe(3);
    const before = dockerRuns(w).length;
    for (const verb of ['play', 'setup']) {
      const r = go([verb, ID]);
      expect(r.status, r.stderr).toBe(1);
      expect(r.stderr).toContain('is being held');
    }
    expect(dockerRuns(w).length).toBe(before);
  });
});

describe.each(forGroup('commands').filter((l) => l.name === 'pwsh'))(
  'status bytes ($name)',
  (l) => {
    it('the output is plain bytes: no BOM, LF endings only', () => {
      const w = makeWorld();
      const { env } = prep(l, w, benign, 'rdy');
      makePlayer(w, { id: 'unb' });
      const r = spawnSync('pwsh', ['-NoProfile', '-File', l.entry, 'status', 'rdy', 'ghost'], {
        env: childEnv(env),
      });
      expect(r.status, String(r.stderr)).toBe(0);
      const b = r.stdout;
      expect([...b.subarray(0, 4)]).toEqual([0x72, 0x64, 0x79, 0x09]);
      expect(b.includes(0x0d)).toBe(false);
      expect(b.toString('latin1')).toBe('rdy\tunborn\tmain\nghost\tmissing\n');
    });
  },
);
