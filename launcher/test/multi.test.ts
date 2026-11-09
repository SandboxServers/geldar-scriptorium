import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bashExe,
  bashPath,
  forGroup,
  type Launcher,
  makeWorld,
  repoRoot,
  run,
  type World,
} from './harness.ts';

vi.setConfig({ testTimeout: 120_000 });

// A tmux stand-in: logs argv (tab-separated); has-session exits FAKE_TMUX_HAS (default 1). With
// FAKE_TMUX_RUN set, a new window's command runs under `env -i`, as a running tmux server would
// start it, so only what the command itself carries reaches the child.
const fakeTmux = `#!/bin/sh
tab=$(printf '\\t')
line=""
for a in "$@"; do line="$line$a$tab"; done
printf '%s\\n' "$line" >> "$FAKE_TMUX_LOG"
case $1 in
  has-session) exit "\${FAKE_TMUX_HAS:-1}" ;;
  new-session | new-window)
    if [ -n "\${FAKE_TMUX_RUN:-}" ]; then
      for a in "$@"; do last=$a; done
      env -i PATH="$PATH" sh -c "$last" >> "$FAKE_TMUX_OUT" 2>&1
    fi
    ;;
esac
exit 0
`;

function setup(l: Launcher, w: World, extra: Record<string, string> = {}) {
  const tmux = join(w.fakeDir, 'tmux');
  writeFileSync(tmux, fakeTmux);
  chmodSync(tmux, 0o755);
  const log = join(w.root, 'tmux.log');
  const out = join(w.root, 'tmux.out');
  const env = {
    ...(l.name === 'bash' ? w.env : w.envPwsh),
    GELDAR_TMUX: bashPath(tmux),
    FAKE_TMUX_LOG: bashPath(log),
    FAKE_TMUX_OUT: bashPath(out),
    TMUX: '',
    ...extra,
  };
  const calls = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((x) => x.split('\t').slice(0, -1))
      : [];
  return { env, calls, out, go: (args: string[]) => run(l, args, { env }) };
}

const windows = (calls: string[][]) =>
  calls.filter((c) => c[0] === 'new-session' || c[0] === 'new-window');

describe.each(forGroup('commands').filter((l) => l.name === 'bash'))(
  'play with several players ($name)',
  (l) => {
    it('1. two ids make one window each, running the launcher with play <id>', () => {
      const w = makeWorld();
      const { go, calls } = setup(l, w);
      const r = go(['play', 'aa', 'bb']);
      expect(r.status, r.stderr).toBe(0);
      const ws = windows(calls());
      expect(ws.map((c) => c[0])).toEqual(['new-session', 'new-window']);
      expect(ws).toHaveLength(2);
      expect(ws[0]?.at(-1)).toMatch(/geldar-play'? play aa$/);
      expect(ws[1]?.at(-1)).toMatch(/geldar-play'? play bb$/);
      expect(ws[0]?.at(-1)).toContain('GELDAR_STATE_DIR=');
      expect(calls().at(-1)?.[0]).toBe('attach-session');
    });

    it('1b. inside tmux only windows are added, no attach', () => {
      const w = makeWorld();
      const { go, calls } = setup(l, w, { TMUX: '/tmp/x,1,0' });
      expect(go(['play', 'aa', 'bb']).status).toBe(0);
      expect(calls().map((c) => c[0])).toEqual(['new-window', 'new-window']);
    });

    it('2. a hostile id is rejected before tmux runs', () => {
      const w = makeWorld();
      const { go, calls } = setup(l, w);
      const r = go(['play', 'aa', 'a;rm -rf']);
      expect(r.status).toBe(2);
      expect(calls()).toEqual([]);
    });

    it('3. a duplicate id is refused', () => {
      const w = makeWorld();
      const { go, calls } = setup(l, w);
      const r = go(['play', 'aa', 'bb', 'aa']);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('listed twice');
      expect(windows(calls())).toEqual([]);
    });

    it('4. four ids print many_players and still start four', () => {
      const w = makeWorld();
      const { go, calls } = setup(l, w);
      const r = go(['play', 'aa', 'bb', 'cc', 'dd']);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toContain("Each player uses your plan's limits");
      expect(windows(calls())).toHaveLength(4);
    });

    it('5. tmux missing: missing_tool', () => {
      const w = makeWorld();
      const empty = join(w.root, 'empty');
      mkdirSync(empty);
      const { env } = setup(l, w);
      const { GELDAR_TMUX: _drop, ...rest } = env;
      const r = run(l, ['play', 'aa', 'bb'], {
        env: { ...rest, GELDAR_TOOL_PATH: bashPath(empty) },
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('tmux');
    });

    it('6. a state directory with a space and a quote still reaches play <id>', () => {
      const w = makeWorld();
      const odd = join(w.root, "sp ace'q");
      mkdirSync(odd, { recursive: true });
      const { go, out } = setup(l, w, {
        GELDAR_STATE_DIR: bashPath(odd),
        FAKE_TMUX_RUN: '1',
      });
      const r2 = go(['play', 'aa', 'bb']);
      expect(r2.status, r2.stderr).toBe(0);
      expect(readFileSync(out, 'utf8')).toContain('No player named aa');
      expect(existsSync(join(odd, 'aa'))).toBe(true);
      expect(existsSync(join(odd, 'bb'))).toBe(true);
    });

    it('7. a lock whose process is gone prints the exact path to remove', () => {
      const w = makeWorld();
      const { go } = setup(l, w);
      const lock = join(w.state, 'aa', 'lock');
      mkdirSync(lock, { recursive: true });
      writeFileSync(join(lock, 'pid'), '2147483646\n');
      const r = go(['play', 'aa']);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('remove the folder');
      expect(r.stderr).toContain('/aa/lock');
    });
  },
);

// A wt stand-in for the PowerShell launcher: logs argv (tab-separated) and exits 0. On Windows a
// .cmd shim runs it through Git's bash, as the other fakes do.
const fakeWt = `#!/bin/sh
tab=$(printf '\t')
line=""
for a in "$@"; do line="$line$a$tab"; done
printf '%s\n' "$line" >> "$FAKE_WT_LOG"
exit 0
`;

function setupWt(l: Launcher, w: World, extra: Record<string, string> = {}) {
  const wt = join(w.fakeDir, 'wt');
  writeFileSync(wt, fakeWt);
  chmodSync(wt, 0o755);
  let exe = wt;
  if (process.platform === 'win32') {
    exe = join(w.fakeDir, 'wt.cmd');
    writeFileSync(exe, `@"${bashExe}" "${bashPath(wt)}" %*\r\n`);
  }
  const log = join(w.root, 'wt.log');
  const env = { ...w.envPwsh, GELDAR_WT: exe, FAKE_WT_LOG: bashPath(log), ...extra };
  const calls = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((x) => x.split('\t').slice(0, -1))
      : [];
  return { env, calls, go: (args: string[]) => run(l, args, { env }) };
}

describe.each(forGroup('commands').filter((l) => l.name === 'pwsh'))(
  'play with several players through wt ($name)',
  (l) => {
    it('1. the first id opens a new window, the rest tabs of window 0, each a pwsh -File play <id>', () => {
      const w = makeWorld();
      const { go, calls } = setupWt(l, w);
      const r = go(['play', 'aa', 'bb']);
      expect(r.status, r.stderr).toBe(0);
      const c = calls();
      expect(c).toHaveLength(2);
      const tab = (id: string, head: string[]) => {
        const row = c[head.length === 0 ? 0 : 1] ?? [];
        expect(row.slice(0, head.length + 3)).toEqual([...head, 'new-tab', '--title', id]);
        const rest = row.slice(head.length + 3);
        expect(rest[0]).toMatch(/pwsh(\.exe)?$/i);
        expect(rest.slice(1, 3)).toEqual(['-NoProfile', '-File']);
        expect(rest[3]).toMatch(/geldar-play\.ps1$/);
        expect(rest.slice(4)).toEqual(['play', id]);
      };
      tab('aa', []);
      tab('bb', ['-w', '0']);
    });

    it('2. a hostile id is rejected before wt runs', () => {
      const w = makeWorld();
      const { go, calls } = setupWt(l, w);
      const r = go(['play', 'aa', 'a;rm -rf']);
      expect(r.status).toBe(2);
      expect(calls()).toEqual([]);
    });

    it('3. a duplicate id is refused', () => {
      const w = makeWorld();
      const { go, calls } = setupWt(l, w);
      const r = go(['play', 'aa', 'bb', 'aa']);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('listed twice');
      expect(calls()).toEqual([]);
    });

    it('4. four ids print many_players and still start four', () => {
      const w = makeWorld();
      const { go, calls } = setupWt(l, w);
      const r = go(['play', 'aa', 'bb', 'cc', 'dd']);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toContain("Each player uses your plan's limits");
      expect(calls()).toHaveLength(4);
    });

    it('5. a launcher path with a space stays one argument', () => {
      const w = makeWorld();
      const dir = join(w.root, 'sp ace');
      mkdirSync(dir);
      const src = join(repoRoot, 'launcher');
      for (const n of ['lib', 'messages.d', 'config', 'geldar-play.ps1']) {
        cpSync(join(src, n), join(dir, n), { recursive: true });
      }
      const { env, calls } = setupWt(l, w);
      const r = run({ ...l, entry: join(dir, 'geldar-play.ps1') }, ['play', 'aa', 'bb'], { env });
      expect(r.status, r.stderr).toBe(0);
      const row = calls()[0] ?? [];
      expect(row[row.indexOf('-File') + 1]).toBe(join(dir, 'geldar-play.ps1'));
      expect(row.at(-2)).toBe('play');
    });

    it('6. a lock whose process is gone prints the exact path to remove', () => {
      const w = makeWorld();
      const { go } = setupWt(l, w);
      const lock = join(w.state, 'aa', 'lock');
      mkdirSync(lock, { recursive: true });
      writeFileSync(join(lock, 'pid'), '2147483646\n');
      const r = go(['play', 'aa']);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('remove the folder');
      expect(r.stderr).toMatch(/[\\/]aa[\\/]lock/);
    });
  },
);
