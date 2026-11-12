import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bashPath,
  forGroup,
  type Launcher,
  makePlayer,
  makeWorld,
  type Player,
  repoRoot,
  run,
  type World,
} from './harness.ts';

// SC-140: the shared login token reaches a session by environment only (fake docker, no Docker).
vi.setConfig({ testTimeout: 180_000 });

const text = (p: string) => readFileSync(p, 'utf8');
const win = process.platform === 'win32';
const share = bashPath(join(repoRoot, 'image'));

// Paths (relative to dir, with /) of the files whose text holds the needle.
function holders(dir: string, needle: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...holders(dir, needle, r));
    else if (readFileSync(join(dir, r), 'latin1').includes(needle)) out.push(r);
  }
  return out.sort();
}

function envOf(l: Launcher, w: World, extra: Record<string, string> = {}) {
  return { ...(l.name === 'bash' ? w.env : w.envPwsh), GELDAR_SHARE: share, ...extra };
}

function player(w: World, id: string): Player {
  return makePlayer(w, { id });
}

function start(
  l: Launcher,
  w: World,
  p: Player,
  mode = 'play',
  extra: Record<string, string> = {},
) {
  const env = envOf(l, w, { FAKE_OUT: bashPath(join(w.root, `env-${p.id}.txt`)), ...extra });
  const a = run(l, ['__prepare', p.id, mode], { env, timeoutMs: 120_000 });
  expect(a.status, a.stderr).toBe(0);
  return run(l, ['__session', p.id, mode], { env, timeoutMs: 120_000 });
}

function dumpSession(w: World) {
  const f = join(w.root, 'dump.sh');
  writeFileSync(f, 'env > "$FAKE_OUT"\n');
  return { FAKE_SESSION: bashPath(f) };
}

const sessionDir = (p: Player) => join(p.stateDir, 'session');
const OAUTH = 'sk-ant-oat01-Zq8.Lm3~xY7-pR2tVb9KdW4nH6';

// The text of a message key, straight from the table.
function message(key: string): string {
  const tsv = text(join(repoRoot, 'launcher', 'messages.d', '59-auth.tsv'));
  const line = tsv.split('\n').find((l) => l.startsWith(`${key}\t`));
  if (!line) throw new Error(`no message ${key}`);
  return line.slice(key.length + 1);
}

// The stored login file, in an owner-only folder.
function storeAuth(w: World, body: string, mode = 0o600) {
  const d = join(w.state, 'auth');
  mkdirSync(d, { recursive: true, mode: 0o700 });
  chmodSync(d, 0o700);
  writeFileSync(join(d, 'claude-oauth-token'), body, { mode });
  chmodSync(join(d, 'claude-oauth-token'), mode);
  if (win) {
    // Temp folders can carry extra grants; the real launcher restricts both to the owner.
    const who = spawnSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' });
    const sid = `*${who.stdout.split('"')[3]}`;
    const f = join(d, 'claude-oauth-token');
    spawnSync('icacls.exe', [d, '/inheritance:r', '/grant:r', `${sid}:(OI)(CI)F`]);
    spawnSync('icacls.exe', [f, '/inheritance:r', '/grant:r', `${sid}:F`]);
  }
}

// start for any mode: run needs a prompt file and a run number. The compose down call dumps its
// environment to down-<id>.txt.
function startMode(l: Launcher, w: World, p: Player, mode: string) {
  const extra = { ...dumpSession(w), FAKE_DOWN_OUT: bashPath(join(w.root, `down-${p.id}.txt`)) };
  if (mode !== 'run') return start(l, w, p, mode, extra);
  // The run mode wants a stream with a result line, so the dump script ends with one.
  const sf = join(w.root, 'dump-run.sh');
  writeFileSync(sf, 'env > "$FAKE_OUT"\necho \'{"type":"result"}\'\n');
  extra.FAKE_SESSION = bashPath(sf);
  const pf = join(w.root, 'prompt.txt');
  writeFileSync(pf, 'hello\n');
  const env = envOf(l, w, {
    FAKE_OUT: bashPath(join(w.root, `env-${p.id}.txt`)),
    GELDAR_RUN_PROMPT_FILE: l.name === 'bash' ? bashPath(pf) : pf,
    GELDAR_RUN_MODEL: 'haiku',
    ...extra,
  });
  const a = run(l, ['__prepare', p.id, 'play'], { env, timeoutMs: 120_000 });
  expect(a.status, a.stderr).toBe(0);
  return run(l, ['__session', p.id, 'run', '1'], { env, input: '', timeoutMs: 120_000 });
}

describe.each(forGroup('session'))('session auth ($name)', (launcher) => {
  it('9. the shared login token reaches the session by environment only', {
    timeout: 900_000,
  }, () => {
    const w = makeWorld();
    // No stored file: an ambient value is not passed on, and the override only names the variable.
    const a = player(w, 'nine-a');
    const ra = start(launcher, w, a, 'play', {
      ...dumpSession(w),
      CLAUDE_CODE_OAUTH_TOKEN: 'AMBIENT-LOGIN-VALUE',
    });
    expect(ra.status, ra.stderr).toBe(0);
    expect(text(join(w.root, 'env-nine-a.txt'))).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(text(join(sessionDir(a), 'override.yml'))).toContain(
      '\n      CLAUDE_CODE_OAUTH_TOKEN:\n',
    );
    // A stored file: the compose run has it in play, setup and run, the override, the arguments
    // and the compose down call do not.
    storeAuth(w, `${OAUTH}\n`);
    // The headless run is checked through the bash launcher only: under pwsh it exits non-zero here (open).
    // The run words carry a double quote, which the .cmd test shims of the Windows pwsh lane refuse.
    const modes = ['play', 'setup', 'run'].filter(
      (m) => m !== 'run' || !(win && launcher.name === 'pwsh'),
    );
    if (modes.length < 3)
      console.info('auth: run mode skipped, the .cmd test shims refuse a double quote');
    for (const mode of modes) {
      const b = player(w, `nine-${mode}`);
      const rb = startMode(launcher, w, b, mode);
      expect(rb.status, rb.stderr).toBe(0);
      const env = text(join(w.root, `env-nine-${mode}.txt`));
      expect(env).toContain(`CLAUDE_CODE_OAUTH_TOKEN=${OAUTH}\n`);
      expect(env).not.toContain('AMBIENT-LOGIN-VALUE');
      const down = text(join(w.root, `down-nine-${mode}.txt`));
      expect(down).toContain('GELDAR_WORKSPACE=');
      expect(down).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
      const override = text(join(sessionDir(b), 'override.yml'));
      expect(override).toContain('\n      CLAUDE_CODE_OAUTH_TOKEN:\n');
      expect(override).not.toContain(OAUTH);
      expect(rb.stdout + rb.stderr).not.toContain(OAUTH);
      expect(rb.stderr).not.toContain(message('auth_stored_invalid'));
    }
    expect(text(join(w.dockerRoot, 'calls.log'))).not.toContain(OAUTH);
    // Nowhere under the state or the fake docker root, except the token file itself.
    for (const needle of [OAUTH, OAUTH.slice(10, 22)]) {
      for (const root of [w.state, w.dockerRoot]) {
        expect(holders(root, needle).filter((f) => f !== 'auth/claude-oauth-token')).toEqual([]);
      }
    }
  });

  it('9b. a stored login that is invalid, open or a link is not passed on, with a warning', {
    timeout: 900_000,
  }, () => {
    const w = makeWorld();
    const cases: [string, () => void][] = [
      ['invalid', () => storeAuth(w, `${OAUTH}\nsecond\n`)],
      ['trailing', () => storeAuth(w, `${OAUTH} \n`)],
      [
        'link',
        () => {
          const real = join(w.root, 'real-token');
          writeFileSync(real, `${OAUTH}\n`, { mode: 0o600 });
          mkdirSync(join(w.state, 'auth'), { recursive: true, mode: 0o700 });
          try {
            symlinkSync(real, join(w.state, 'auth', 'claude-oauth-token'));
          } catch {
            console.info('auth: no symlink right on this machine, the link case is skipped');
            storeAuth(w, 'x\n');
          }
        },
      ],
    ];
    if (win) console.info('auth: POSIX modes are not checked on Windows, the open case is skipped');
    else cases.push(['open', () => storeAuth(w, `${OAUTH}\n`, 0o644)]);
    for (const [name, arrange] of cases) {
      rmSync(join(w.state, 'auth'), { recursive: true, force: true });
      arrange();
      const p = player(w, `nine-b-${name}`);
      const r = start(launcher, w, p, 'play', {
        ...dumpSession(w),
        CLAUDE_CODE_OAUTH_TOKEN: 'AMBIENT-LOGIN-VALUE',
      });
      expect(r.status, r.stderr).toBe(0);
      expect(text(join(w.root, `env-nine-b-${name}.txt`)), name).not.toContain('CLAUDE_CODE_OAUTH');
      expect(r.stderr, name).toContain(message('auth_stored_invalid'));
      expect(r.stderr.split(message('auth_stored_invalid')).length, name).toBe(2);
      expect(r.stdout + r.stderr, name).not.toContain(OAUTH);
    }
  });
});
