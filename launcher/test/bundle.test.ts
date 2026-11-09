import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bashPath,
  forGroup,
  git,
  type Launcher,
  makePlayer,
  makeWorld,
  type Player,
  repoRoot,
  run,
  runBash,
  type World,
} from './harness.ts';
import { timingIt } from './timing.ts';

vi.setConfig({ testTimeout: 180_000 });

const share = bashPath(join(repoRoot, 'image'));
const libDir = bashPath(join(repoRoot, 'launcher', 'lib'));
const gitCli = bashPath(join(repoRoot, 'packages', 'git', 'src', 'cli.ts'));
const OK = '{"ok":true,"reasons":[]}';
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

function envOf(l: Launcher, w: World, extra: Record<string, string> = {}) {
  return { ...(l.name === 'bash' ? w.env : w.envPwsh), GELDAR_SHARE: share, ...extra };
}

// Commits as the player: both author and committer are the noreply identity.
const asPlayer = (id: string) =>
  `export GIT_AUTHOR_NAME=player-${id} GIT_AUTHOR_EMAIL=player-${id}@users.noreply.github.com
export GIT_COMMITTER_NAME=player-${id} GIT_COMMITTER_EMAIL=player-${id}@users.noreply.github.com
`;

const benign = `mkdir -p memory/journal
echo hello > memory/journal/day-001.md
node ${gitCli} commit --root . --message "day one" --mode play
`;

interface Ran {
  p: Player;
  env: Record<string, string>;
  finish: (args?: string[], env?: Record<string, string>) => ReturnType<typeof run>;
  bundlePath: string;
}

// prepare + session with the given session script, ready to finish.
function session(
  l: Launcher,
  w: World,
  id: string,
  script: string,
  opts: { mode?: string; extra?: Record<string, string> } = {},
): Ran {
  const mode = opts.mode ?? 'play';
  const p = makePlayer(w, { id });
  const sf = join(w.root, `${id}-session.sh`);
  writeFileSync(sf, `${asPlayer(id)}${script}`);
  const env = envOf(l, w, { FAKE_SESSION: bashPath(sf), ...opts.extra });
  const a = run(l, ['__prepare', id, mode], { env, timeoutMs: 120_000 });
  expect(a.status, a.stderr).toBe(0);
  const b = run(l, ['__session', id, mode], { env, timeoutMs: 120_000 });
  expect(b.status, b.stderr).toBe(0);
  return {
    p,
    env,
    bundlePath: join(p.stateDir, 'session', 'bundle.bundle'),
    finish: (args = ['--until', 'verify'], more = {}) =>
      run(l, ['__finish', id, ...args], { env: { ...env, ...more }, timeoutMs: 120_000 }),
  };
}

const roleCall = (w: World, role: string) =>
  w.calls().find((c) => c[0] === 'run' && c.includes(`geldar.role=${role}`));
const heldInfo = (p: Player) => readFileSync(join(p.stateDir, 'held', 'info'), 'utf8');

const hostile: [string, string, string][] = [
  [
    'CLAUDE.md changed',
    'echo x >> CLAUDE.md\ngit add CLAUDE.md\ngit commit -q -m m\n',
    'something a player may not change',
  ],
  [
    'a symlink at memory/x.md',
    'b=$(printf target | git hash-object -w --stdin)\ngit update-index --add --cacheinfo 120000,$b,memory/x.md\ngit commit -q -m m\n',
    'link where a file belongs',
  ],
  [
    'a merge commit',
    [
      'git checkout -q -b side',
      'mkdir -p memory',
      'echo a > memory/a.md',
      'git add memory/a.md',
      'git commit -q -m a',
      'git checkout -q main',
      'echo b > memory/b.md',
      'git add memory/b.md',
      'git commit -q -m b',
      'git merge -q --no-ff side -m merged',
      '',
    ].join('\n'),
    'joined two lines',
  ],
  [
    'an author who is not the player',
    'mkdir -p memory\necho a > memory/a.md\ngit add memory/a.md\nGIT_AUTHOR_NAME=Other GIT_AUTHOR_EMAIL=o@example.test git commit -q -m m\n',
    'name that is not the player',
  ],
  [
    'identity.md changed in play mode',
    'echo changed >> memory/identity.md\ngit add memory/identity.md\ngit commit -q -m m\n',
    'changed who the player is',
  ],
];

const author = {
  GIT_AUTHOR_NAME: 'P',
  GIT_AUTHOR_EMAIL: 'p@example.test',
  GIT_COMMITTER_NAME: 'P',
  GIT_COMMITTER_EMAIL: 'p@example.test',
};

// A repo whose first commit is START, then `script` run on top of it.
function repoWith(w: World, name: string, script: string) {
  const dir = join(w.root, name);
  mkdirSync(join(dir, 'memory'), { recursive: true });
  const env = { ...author, GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
  const g = (...a: string[]) => git(dir, a, env);
  g('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'CLAUDE.md'), 'x\n');
  writeFileSync(join(dir, '.mcp.json'), '{}\n');
  writeFileSync(join(dir, 'memory', 'a.md'), 'a\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'start');
  const start = g('rev-parse', 'HEAD');
  const sf = join(w.root, `${name}.sh`);
  writeFileSync(sf, script);
  const r = runBash(`cd '${bashPath(dir)}' && sh '${bashPath(sf)}'`, {
    env: { ...w.env, ...author, GIT_CONFIG_GLOBAL: bashPath(join(w.root, 'gitconfig')) },
  });
  expect(r.status, r.stderr).toBe(0);
  return { dir, start };
}

function recheck(w: World, dir: string, start: string, mode = 'play') {
  const r = runBash(
    `. '${libDir}/common.sh'; . '${libDir}/recheck.sh'; host_recheck '${bashPath(dir)}' ${start} HEAD ${mode}; echo "rc=$? why=$RC_WHY"`,
    { env: w.env },
  );
  return r.stdout.trim();
}

for (const l of forGroup('bundle')) {
  describe(`${l.name}: bundle, verify and host re-check`, () => {
    it('1. a benign session is accepted; the helpers have no network and no CLI volume', () => {
      const w = makeWorld();
      const r = session(l, w, 'abc', benign);
      const f = r.finish();
      expect(f.status, f.stderr).toBe(0);
      expect(f.stderr).toContain('The check of the session passed.');
      const b = roleCall(w, 'bundle') ?? [];
      expect(b[b.indexOf('--network') + 1]).toBe('none');
      expect(b.some((a) => a.includes('geldar-cli-'))).toBe(false);
      expect(b).toContain('geldar-ws-abc:/player:ro');
      const v = roleCall(w, 'verify') ?? [];
      expect(v[v.indexOf('--network') + 1]).toBe('none');
      expect(v).toContain('--read-only');
      expect(v[v.indexOf('--start') + 1]).toBe(
        readFileSync(join(r.p.stateDir, 'start'), 'utf8').trim(),
      );
    });

    it('2. H-09: the bundle is made after the compose project is down', () => {
      const w = makeWorld();
      const r = session(l, w, 'abc', benign);
      expect(r.finish().status).toBe(0);
      const calls = w.calls();
      const down = calls.findIndex((c) => c[0] === 'compose' && c.includes('down'));
      const bundle = calls.findIndex((c) => c[0] === 'run' && c.includes('geldar.role=bundle'));
      expect(down).toBeGreaterThanOrEqual(0);
      expect(bundle).toBeGreaterThan(down);
    });

    timingIt(
      '3. H-10: a bundle over the cap is cut, the container killed, the session held',
      () => {
        const w = makeWorld();
        const script = `mkdir -p memory
head -c 62914560 /dev/urandom > memory/big.md
git add memory/big.md
git commit -q -m big
`;
        const r = session(l, w, 'abc', script, { extra: { FAKE_BUNDLE_HANG: '1' } });
        const f = r.finish();
        expect(f.status, f.stderr).toBe(3);
        expect(f.stderr).toContain('far too much');
        expect(statSync(r.bundlePath).size).toBe(52428801);
        const kill = w
          .calls()
          .find((c) => c[0] === 'kill' && /^geldar-bundle-abc-/.test(c[1] ?? ''));
        expect(kill).toBeDefined();
        expect(readdirSync(join(w.dockerRoot, 'pids'))).toEqual([]);
        expect(heldInfo(r.p)).toContain('reason=bundle_too_large');
      },
      180_000,
    );

    describe('4. H-11 through the real gate', () => {
      it.each(hostile)('%s', (_n, script, text) => {
        const w = makeWorld();
        const r = session(l, w, 'abc', script);
        const f = r.finish();
        expect(f.status, f.stderr).toBe(3);
        expect(f.stderr).toContain(text);
        expect(f.stderr).not.toMatch(/path_not_allowed|merge_commit|identity_|symlink_not|reason_/);
        expect(existsSync(join(r.p.stateDir, 'held', 'bundle.bundle'))).toBe(true);
      });

      it('identity.md changes are accepted in setup mode', () => {
        const w = makeWorld();
        const script =
          'echo "I am Abc." > memory/identity.md\ngit add memory/identity.md\ngit commit -q -m born\n';
        const r = session(l, w, 'abc', script, { mode: 'setup' });
        const f = r.finish();
        expect(f.status, f.stderr).toBe(0);
      });
    });

    it('5. H-16: escape bytes in a path never reach the output', () => {
      const w = makeWorld();
      const script = [
        "p=$(printf 'memory/\\033]0;pwned\\007.md')",
        'b=$(printf x | git hash-object -w --stdin)',
        'git update-index --add --cacheinfo 100644,$b,"$p"',
        't=$(git write-tree)',
        "m=$(printf 'subj \\033]0;pwned\\007 end')",
        'c=$(git commit-tree -p HEAD -m "$m" $t)',
        'git update-ref refs/heads/main $c',
        '',
      ].join('\n');
      const r = session(l, w, 'abc', script, { extra: { FAKE_VERIFY_STDOUT: OK } });
      const f = r.finish();
      expect(f.status, f.stderr).toBe(3);
      expect(f.stderr).toContain('pwned');
      expect(f.stderr).toContain('second check');
      for (const out of [f.stdout, f.stderr]) {
        expect(out.includes(ESC)).toBe(false);
        expect(out.includes(BEL)).toBe(false);
      }
    });

    describe('6. only the exact verdict on exit 0 accepts', () => {
      it.each([
        ['garbage', { FAKE_VERIFY_STDOUT: 'garbage' }],
        ['ok text with a failing exit', { FAKE_VERIFY_STDOUT: OK, FAKE_VERIFY_RC: '1' }],
        ['empty output', { FAKE_VERIFY_STDOUT: '' }],
        [
          'an unknown reason',
          { FAKE_VERIFY_STDOUT: '{"ok":false,"reasons":["nope"]}', FAKE_VERIFY_RC: '1' },
        ],
      ])('%s', (_n, extra) => {
        const w = makeWorld();
        const r = session(l, w, 'abc', benign, { extra });
        const f = r.finish();
        expect(f.status, f.stderr).toBe(3);
        expect(f.stderr).toContain('no clear answer');
        expect(heldInfo(r.p)).toContain('reason=verify_unreadable');
      });
    });

    describe('7. H-13: the host re-check does not trust the gate', () => {
      const bad: [string, string, string][] = [
        ['CLAUDE.md', 'echo y >> CLAUDE.md\ngit commit -q -am m\n', 'CLAUDE.md'],
        ['a deleted .mcp.json', 'git rm -q .mcp.json\ngit commit -q -m m\n', '.mcp.json'],
        [
          'a rename away from an allowed path',
          'mkdir -p notes\ngit mv memory/a.md notes/a.md\ngit commit -q -m m\n',
          '',
        ],
        [
          'mode 100755',
          'echo z > memory/x.md\ngit add --chmod=+x memory/x.md\ngit commit -q -m m\n',
          'memory/x.md',
        ],
        [
          'a merge',
          [
            'git checkout -q -b side',
            'echo s > memory/s.md',
            'git add memory/s.md',
            'git commit -q -m s',
            'git checkout -q main',
            'echo t > memory/t.md',
            'git add memory/t.md',
            'git commit -q -m t',
            'git merge -q --no-ff side -m merged',
            '',
          ].join('\n'),
          'merge',
        ],
      ];
      it.each(bad)('rejects %s', (name, script, why) => {
        const w = makeWorld();
        const { dir, start } = repoWith(w, 'r', script);
        const out = recheck(w, dir, start);
        expect(out).toMatch(/^rc=1 why=/);
        if (why) expect(out).toContain(why);
        if (name !== 'a merge') {
          const diff = w.gitCalls().find((c) => c.includes('diff'));
          for (const flag of ['--raw', '-z', '--no-renames', '--no-textconv', '--no-ext-diff']) {
            expect(diff, flag).toContain(flag);
          }
        }
      });

      it('accepts a benign change, and the identity file only in setup mode', () => {
        const w = makeWorld();
        const ok = repoWith(
          w,
          'r',
          'mkdir -p memory/journal\necho a > memory/journal/day-001.md\ngit add -A\ngit commit -q -m m\n',
        );
        expect(recheck(w, ok.dir, ok.start)).toBe('rc=0 why=');
        const id = repoWith(
          w,
          'r2',
          'echo i > memory/identity.md\ngit add -A\ngit commit -q -m m\n',
        );
        expect(recheck(w, id.dir, id.start, 'play')).toMatch(/^rc=1 why=memory\/identity.md/);
        expect(recheck(w, id.dir, id.start, 'setup')).toBe('rc=0 why=');
      });
    });

    it('8. path_allowed (the bash twin) agrees with every case in path-cases.json', () => {
      const w = makeWorld();
      const cases = JSON.parse(
        readFileSync(join(repoRoot, 'launcher', 'test', 'path-cases.json'), 'utf8'),
      ) as { path: string; mode: string; allowed: boolean }[];
      const data = join(w.root, 'cases.bin');
      const nul = String.fromCharCode(0);
      writeFileSync(
        data,
        cases.map((c) => [c.path, c.mode, c.allowed ? 'yes' : 'no'].join(nul) + nul).join(''),
      );
      const script = `. '${libDir}/common.sh'; . '${libDir}/recheck.sh'
bad=0
while IFS= read -r -d '' p && IFS= read -r -d '' m && IFS= read -r -d '' want; do
  if path_allowed "$p" "$m"; then got=yes; else got=no; fi
  [ "$got" = "$want" ] || { bad=$((bad + 1)); printf 'MISMATCH %q %s want %s\\n' "$p" "$m" "$want"; }
done < '${bashPath(data)}'
echo "bad=$bad"`;
      const r = runBash(script, { env: w.env });
      expect(r.stdout.trim()).toBe('bad=0');
    });

    describe('9. watchdog', () => {
      for (const role of ['bundle', 'verify'] as const) {
        timingIt(`a hung ${role} container is killed and the session held`, () => {
          const w = makeWorld();
          const r = session(l, w, 'abc', benign);
          const t0 = Date.now();
          const f = r.finish(['--until', 'verify'], {
            GELDAR_HELPER_TIMEOUT_SEC: '2',
            [role === 'bundle' ? 'FAKE_BUNDLE_SLEEP' : 'FAKE_VERIFY_SLEEP']: '30',
          });
          expect(Date.now() - t0).toBeLessThan(15_000);
          expect(f.status, f.stderr).toBe(3);
          const calls = w.calls();
          const named = (c: string[]) => (c[c.length - 1] ?? '').startsWith(`geldar-${role}-abc-`);
          expect(calls.some((c) => c[0] === 'kill' && named(c))).toBe(true);
          expect(calls.some((c) => c[0] === 'rm' && c[1] === '-f' && named(c))).toBe(true);
          expect(existsSync(join(r.p.stateDir, 'held', 'info'))).toBe(true);
        });
      }
    });
  });
}
