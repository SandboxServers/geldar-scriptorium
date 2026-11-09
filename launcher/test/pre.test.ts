import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
  type World,
} from './harness.ts';

const text = (p: string) => readFileSync(p, 'utf8');

function envOf(l: Launcher, w: World, extra: Record<string, string> = {}) {
  return { ...(l.name === 'bash' ? w.env : w.envPwsh), ...extra };
}

function gitEnv(w: World) {
  return { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
}

// Docker calls that matter: the prerequisite probes are not "a docker call" for these cases.
function dockerCalls(w: World): string[][] {
  return w.calls().filter((c) => {
    if (c[0] === 'compose' || c[0] === 'version' || c[0] === 'info') return false;
    return !(c[0] === 'image' && c[1] === 'inspect');
  });
}

function prep(l: Launcher, w: World, p: Player, mode = 'play', extra: Record<string, string> = {}) {
  return run(l, ['__prepare', p.id, mode], { env: envOf(l, w, extra), timeoutMs: 120_000 });
}

// A second clone of the player's origin, to push as "another machine".
function second(w: World, p: Player, name = 'second'): string {
  const dir = join(w.root, name);
  git(w.root, ['clone', p.origin, dir], gitEnv(w));
  return dir;
}

function commitFile(w: World, dir: string, file: string, body: string, push: boolean) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), body);
  git(dir, ['add', '-A'], gitEnv(w));
  git(dir, ['commit', '-m', `edit ${file}`], gitEnv(w));
  if (push) git(dir, ['push', 'origin', 'main'], gitEnv(w));
}

function editPlayer(w: World, dir: string, key: string, value: string, push: boolean) {
  const f = join(dir, 'player.json');
  const j = JSON.parse(text(f));
  j[key] = value;
  commitFile(w, dir, 'player.json', `${JSON.stringify(j, null, 2)}\n`, push);
}

const volDir = (w: World, p: Player) => join(w.dockerRoot, 'vol', `geldar-ws-${p.id}`);

describe.each(forGroup('pre'))('pre ($name)', (launcher) => {
  it('1. a clean clone prepares: start is HEAD, mode is play', () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'one' });
    const r = prep(launcher, w, p);
    expect(r.status, r.stderr).toBe(0);
    const head = git(p.clone, ['rev-parse', 'HEAD']);
    expect(text(join(p.stateDir, 'start')).trim()).toBe(head);
    expect(text(join(p.stateDir, 'mode')).trim()).toBe('play');
    expect(existsSync(join(p.stateDir, 'session', 'running'))).toBe(true);
  }, 120_000);

  it('2. H-01 untracked, modified and nested untracked files are dirty', () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'two' });
    const cases: Array<() => void> = [
      () => writeFileSync(join(p.clone, 'new.txt'), 'x'),
      () => writeFileSync(join(p.clone, 'CLAUDE.md'), 'changed\n'),
      () => {
        mkdirSync(join(p.clone, 'a', 'b'), { recursive: true });
        writeFileSync(join(p.clone, 'a', 'b', 'c.txt'), 'x');
      },
      // A clone-local status.showUntrackedFiles=no hides every untracked file from plain
      // `status --porcelain`; only --untracked-files=all overrides it.
      () => {
        git(p.clone, ['config', 'status.showUntrackedFiles', 'no'], gitEnv(w));
        writeFileSync(join(p.clone, 'hidden.txt'), 'x');
      },
    ];
    for (const make of cases) {
      git(p.clone, ['checkout', '--', '.'], gitEnv(w));
      git(p.clone, ['clean', '-fdq'], gitEnv(w));
      make();
      const r = prep(launcher, w, p);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('has changes that are not saved');
      expect(dockerCalls(w)).toEqual([]);
      expect(existsSync(join(p.stateDir, 'start'))).toBe(false);
    }
    git(p.clone, ['config', '--unset', 'status.showUntrackedFiles'], gitEnv(w));
  }, 120_000);

  it('3. H-02 pulls new commits; a diverged clone is refused', () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'three' });
    const other = second(w, p);
    commitFile(w, other, 'memory/new.md', 'n\n', true);
    const tip = git(other, ['rev-parse', 'HEAD']);
    const r = prep(launcher, w, p);
    expect(r.status, r.stderr).toBe(0);
    expect(text(join(p.stateDir, 'start')).trim()).toBe(tip);

    const w2 = makeWorld();
    const q = makePlayer(w2, { id: 'diverge' });
    const other2 = second(w2, q);
    commitFile(w2, other2, 'memory/remote.md', 'r\n', true);
    commitFile(w2, q.clone, 'memory/local.md', 'l\n', false);
    const bad = prep(launcher, w2, q);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('Could not bring diverge up to date');
    expect(dockerCalls(w2)).toEqual([]);
  }, 120_000);

  it('4. H-03 start is rewritten from HEAD; no lib reads start from the workspace', () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'four' });
    writeFileSync(join(p.stateDir, 'start'), `${'b'.repeat(40)}\n`);
    expect(prep(launcher, w, p).status).toBe(0);
    expect(text(join(p.stateDir, 'start')).trim()).toBe(git(p.clone, ['rev-parse', 'HEAD']));
    const libDir = join(repoRoot, 'launcher', 'lib');
    for (const f of readdirSync(libDir).filter((x) => x.endsWith('.sh'))) {
      const body = text(join(libDir, f));
      expect(body, f).not.toMatch(/(\/player|vol\/)[^\n]*\bstart\b/);
      for (const line of body.split('\n')) {
        if (/["/]start["\s]|\/start$/.test(line) && /(cat|read|<)/.test(line)) {
          expect(line, f).toMatch(/\$d\/start|player_dir/);
        }
      }
    }
  }, 120_000);

  it('5. H-04 the export is START: committed bytes, no ignored files, no memory or skills', () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'five' });
    writeFileSync(join(p.clone, '.git', 'info', 'exclude'), 'secret.txt\n');
    writeFileSync(join(p.clone, 'secret.txt'), 'hush\n');
    const hook = join(w.root, 'hook.sh');
    writeFileSync(hook, "printf 'appended\\n' >> CLAUDE.md\n");
    const r = prep(launcher, w, p, 'play', { GELDAR_TEST_HOOK_AFTER_CLEAN: bashPath(hook) });
    expect(r.status, r.stderr).toBe(0);
    const ex = join(p.stateDir, 'session', 'export');
    for (const f of ['CLAUDE.md', '.claude/settings.json', 'player.json', '.mcp.json']) {
      expect(existsSync(join(ex, f)), f).toBe(true);
    }
    const committed = spawnSync('git', ['show', 'HEAD:CLAUDE.md'], {
      cwd: p.clone,
      encoding: 'utf8',
    }).stdout;
    expect(text(join(ex, 'CLAUDE.md'))).toBe(committed);
    expect(text(join(ex, 'CLAUDE.md'))).not.toContain('appended');
    expect(existsSync(join(ex, 'secret.txt'))).toBe(false);
    expect(existsSync(join(ex, 'memory'))).toBe(false);
    expect(existsSync(join(ex, 'skills'))).toBe(false);
  }, 120_000);

  it('6. H-05 the workspace is a clean repo at START with no origin and no host path', () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'six' });
    const r = prep(launcher, w, p);
    expect(r.status, r.stderr).toBe(0);
    const v = volDir(w, p);
    expect(git(v, ['rev-parse', 'HEAD'])).toBe(git(p.clone, ['rev-parse', 'HEAD']));
    expect(git(v, ['branch', '--show-current'])).toBe('main');
    expect(git(v, ['remote'])).toBe('');
    expect(git(v, ['config', '--local', 'core.autocrlf'])).toBe('false');
    const runCall = w.calls().find((c) => c[0] === 'run' && c.join(' ').includes('git clone'));
    expect(runCall?.join(' ')).toContain('--no-local');
    expect(runCall?.join(' ')).toContain('--no-hardlinks');
    const cfg = text(join(v, '.git', 'config'));
    expect(cfg).not.toContain(bashPath(p.clone));
    expect(cfg).not.toContain(bashPath(w.state));

    // A helper that leaks the clone path into the config is caught.
    const w2 = makeWorld();
    const q = makePlayer(w2, { id: 'plant' });
    const shim = join(w2.fakeDir, 'docker-plant');
    const fake = bashPath(join(repoRoot, 'launcher', 'test', 'fake-docker.sh'));
    writeFileSync(
      shim,
      [
        '#!/bin/sh',
        `sh "${fake}" "$@"`,
        'rc=$?',
        'case "$*" in',
        '  *-check*) ;;',
        '  *workspace-init*) printf "[leak]\\n\\tp = %s\\n" "$PLANT" >> "$FAKE_DOCKER_ROOT/vol/geldar-ws-plant/.git/config" ;;',
        'esac',
        'exit $rc',
        '',
      ].join('\n'),
    );
    chmodSync(shim, 0o755);
    const bad = prep(launcher, w2, q, 'play', {
      GELDAR_DOCKER: bashPath(shim),
      PLANT: bashPath(q.clone),
    });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('was not isolated');
    expect(existsSync(join(q.stateDir, 'session', 'running'))).toBe(false);
  }, 120_000);

  it('7. hostile player.json values are refused with no docker call', () => {
    const bad: Array<[string, string, string]> = [
      ['kit_image', 'registry.test/geldar-kit:latest', 'is not valid'],
      ['mcp_url', 'https://user:pw@mcp.registry.test/mcp', 'is not valid'],
      ['mcp_url', 'https://10.0.0.1/mcp', 'is not valid'],
      ['mcp_url', 'https://127.1/mcp', 'is not valid'],
      ['mcp_url', 'https://2130706433/mcp', 'is not valid'],
      ['mcp_url', 'https://mcp.registry.test:8080/mcp', 'is not valid'],
      ['harness', 'codex', 'this version cannot run'],
    ];
    let n = 0;
    for (const [key, value, msg] of bad) {
      const w = makeWorld();
      const p = makePlayer(w, { id: `hostile${n++}` });
      editPlayer(w, p.clone, key, value, false);
      const r = prep(launcher, w, p);
      expect(r.status, `${key}=${value}`).toBe(1);
      expect(r.stderr, `${key}=${value}`).toContain(msg);
      expect(dockerCalls(w)).toEqual([]);
    }
    const w = makeWorld();
    const p = makePlayer(w, { id: 'branchy' });
    writeFileSync(join(p.stateDir, 'branch'), 'a..b\n');
    const r = prep(launcher, w, p);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('branch name');
    expect(dockerCalls(w)).toEqual([]);
    // The working file is not read: an edit made after the clean check does not matter.
    const w3 = makeWorld();
    const q = makePlayer(w3, { id: 'wtree' });
    const hook = join(w3.root, 'hook.sh');
    writeFileSync(
      hook,
      "sed 's/@sha256:[0-9a-f]*/:latest/' player.json > p.tmp && mv p.tmp player.json\n",
    );
    const ok = prep(launcher, w3, q, 'play', { GELDAR_TEST_HOOK_AFTER_CLEAN: bashPath(hook) });
    expect(ok.status, ok.stderr).toBe(0);
  }, 240_000);

  it('8. a second prepare while a session is recorded is unfinished', () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'eight' });
    expect(prep(launcher, w, p).status).toBe(0);
    const before = w.calls().filter((c) => c[0] === 'run').length;
    const r = prep(launcher, w, p);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('did not finish');
    expect(w.calls().filter((c) => c[0] === 'run').length).toBe(before);
    expect(existsSync(join(p.stateDir, 'start'))).toBe(true);
  }, 120_000);

  it('9. a committed symlink is refused', () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'nine' });
    const g = gitEnv(w);
    git(p.clone, ['rm', '-r', '-q', '--cached', '.claude'], g);
    const hashed = spawnSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: p.clone,
      input: join(w.root, 'target'),
      encoding: 'utf8',
      env: { ...process.env, ...g },
    }).stdout.trim();
    git(p.clone, ['update-index', '--add', '--cacheinfo', `120000,${hashed},.claude`], g);
    git(p.clone, ['commit', '-m', 'link'], g);
    git(p.clone, ['checkout', '-f', '--', '.claude'], g);
    git(p.clone, ['clean', '-fdxq'], g);
    const r = prep(launcher, w, p);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('holds a link');
    expect(dockerCalls(w)).toEqual([]);
  }, 120_000);

  it('10. GELDAR_KIT_IMAGE: digest ok, tag refused, tag with both variables is loud', () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'ten' });
    const tag = 'geldar-kit:sc50b';
    const refused = prep(launcher, w, p, 'play', { GELDAR_KIT_IMAGE: tag });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('not pinned by digest');
    expect(dockerCalls(w)).toEqual([]);
    const loud = prep(launcher, w, p, 'play', { GELDAR_KIT_IMAGE: tag, GELDAR_UNSAFE_IMAGE: '1' });
    expect(loud.status, loud.stderr).toBe(0);
    expect(loud.stderr).toContain('UNSAFE:');
    const w2 = makeWorld();
    const q = makePlayer(w2, { id: 'tenb' });
    const digest = `registry.test/other@sha256:${'c'.repeat(64)}`;
    const ok = prep(launcher, w2, q, 'play', { GELDAR_KIT_IMAGE: digest });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stderr).not.toContain('UNSAFE');
    expect(w2.calls().some((c) => c.includes(digest))).toBe(true);
  }, 120_000);

  it('11. a leftover volume is recreated; a held session blocks everything', () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'eleven' });
    mkdirSync(volDir(w, p), { recursive: true });
    writeFileSync(join(volDir(w, p), 'stale.txt'), 'old\n');
    const r = prep(launcher, w, p);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(volDir(w, p), 'stale.txt'))).toBe(false);
    expect(existsSync(join(volDir(w, p), '.git'))).toBe(true);

    const w2 = makeWorld();
    const q = makePlayer(w2, { id: 'held' });
    mkdirSync(join(q.stateDir, 'held'), { recursive: true });
    writeFileSync(join(q.stateDir, 'held', 'info'), 'reason=push_failed\nstart=x\n');
    const h = prep(launcher, w2, q);
    expect(h.status).toBe(1);
    expect(h.stderr).toContain('is being held (push_failed)');
    expect(dockerCalls(w2)).toEqual([]);
  }, 120_000);

  it('12. setup runs on an unborn player, and not after a pull shows it born', () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'twelve' });
    const ok = prep(launcher, w, p, 'setup');
    expect(ok.status, ok.stderr).toBe(0);
    expect(text(join(p.stateDir, 'mode')).trim()).toBe('setup');

    const w2 = makeWorld();
    const q = makePlayer(w2, { id: 'born' });
    const other = second(w2, q);
    commitFile(w2, other, 'memory/identity.md', '# Identity\n\nI am Born.\n', true);
    const r = prep(launcher, w2, q, 'setup');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('already has an identity');
    expect(dockerCalls(w2)).toEqual([]);
    expect(existsSync(join(q.stateDir, 'start'))).toBe(false);
  }, 120_000);

  it('13. a hung helper or pull is bounded and leaves nothing behind', () => {
    // The stand-ins sleep far longer than the 10 s bound, so only the bound ends them, and each
    // records its child pid so the test can prove nothing is left running.
    const pids: string[] = [];
    const pidsIn = (file: string) =>
      existsSync(file)
        ? text(file)
            .split('\n')
            .filter((l) => /^[0-9]+$/.test(l))
        : [];
    const alive = (pid: string) =>
      spawnSync('bash', ['-c', 'kill -0 "$1" 2>/dev/null', 'x', pid]).status === 0;
    try {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'thirteen' });
      const pf = join(w.root, 'pids-a');
      const t0 = Date.now();
      const r = prep(launcher, w, p, 'play', {
        FAKE_ROLE_SLEEP: '120',
        FAKE_PIDFILE: bashPath(pf),
        GELDAR_HELPER_TIMEOUT_SEC: '10',
      });
      expect(Date.now() - t0).toBeLessThan(40_000);
      expect(r.status).toBe(1);
      const a = pidsIn(pf);
      pids.push(...a);
      expect(a.length).toBeGreaterThan(0);
      const kills = w
        .calls()
        .filter((c) => c[0] === 'kill' && /^geldar-workspace-init-/.test(c[1] ?? ''));
      expect(kills.length).toBe(1);
      const name = kills[0]?.[1];
      expect(w.calls().some((c) => c[0] === 'rm' && c[1] === '-f' && c[2] === name)).toBe(true);
      for (const f of ['start', 'mode', 'session/running']) {
        expect(existsSync(join(p.stateDir, f)), f).toBe(false);
      }
      expect(existsSync(volDir(w, p))).toBe(false);

      const w2 = makeWorld();
      const q = makePlayer(w2, { id: 'pullhang' });
      const pf2 = join(w2.root, 'pids-b');
      const t1 = Date.now();
      const s = prep(launcher, w2, q, 'play', {
        FAKE_GIT_SLEEP_ON: 'pull',
        FAKE_GIT_SLEEP_SEC: '120',
        FAKE_PIDFILE: bashPath(pf2),
        GELDAR_HELPER_TIMEOUT_SEC: '10',
      });
      expect(Date.now() - t1).toBeLessThan(40_000);
      expect(s.status).toBe(1);
      expect(s.stderr).toContain('Could not bring pullhang up to date');
      expect(s.stderr).toContain('(timed out)');
      expect(dockerCalls(w2)).toEqual([]);
      const b = pidsIn(pf2);
      pids.push(...b);
      expect(b.length).toBeGreaterThan(0);

      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
      for (const pid of pids) expect(alive(pid), `pid ${pid} still running`).toBe(false);
    } finally {
      // Only the pids the stand-ins recorded, never anything by name.
      for (const pid of pids) {
        if (alive(pid)) spawnSync('bash', ['-c', 'kill -KILL "$1" 2>/dev/null', 'x', pid]);
      }
    }
  }, 180_000);

  it('14. player.json is read at START, after the pull', () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'fourteen' });
    const other = second(w, p);
    editPlayer(w, other, 'kit_image', 'registry.test/geldar-kit:latest', true);
    const r = prep(launcher, w, p);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('is not valid');
    expect(dockerCalls(w)).toEqual([]);
    expect(existsSync(join(p.stateDir, 'start'))).toBe(false);
  }, 120_000);
});
