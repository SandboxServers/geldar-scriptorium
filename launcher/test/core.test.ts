import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bashExe,
  bashPath,
  childEnv,
  forGroup,
  git,
  type Launcher,
  launchers,
  makePlayer,
  makeWorld,
  repoRoot,
  run,
  runBash,
  runLib,
} from './harness.ts';
import { enabled } from './parity.ts';
import { timingIt } from './timing.ts';

const lib = bashPath(join(repoRoot, 'launcher', 'lib', 'common.sh'));
const fakeDockerSh = bashPath(join(repoRoot, 'launcher', 'test', 'fake-docker.sh'));
const sources = [
  join(repoRoot, 'launcher', 'geldar-play'),
  ...readdirSync(join(repoRoot, 'launcher', 'lib'))
    .filter((f) => f.endsWith('.sh'))
    .map((f) => join(repoRoot, 'launcher', 'lib', f)),
];
const psSources = [
  join(repoRoot, 'launcher', 'geldar-play.ps1'),
  ...readdirSync(join(repoRoot, 'launcher', 'lib'))
    .filter((f) => f.endsWith('.ps1'))
    .map((f) => join(repoRoot, 'launcher', 'lib', f)),
];
const tsvFiles = readdirSync(join(repoRoot, 'launcher', 'messages.d'))
  .filter((f) => f.endsWith('.tsv'))
  .map((f) => join(repoRoot, 'launcher', 'messages.d', f));
const text = (p: string) => readFileSync(p, 'utf8');

function envOf(launcher: Launcher, world: ReturnType<typeof makeWorld>, extra = {}) {
  return { ...(launcher.name === 'bash' ? world.env : world.envPwsh), ...extra };
}

const win = process.platform === 'win32';

function ciRequiresShells(ci: string | undefined): boolean {
  return ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false';
}
const groupLaunchers: Record<string, Launcher[]> = Object.fromEntries(
  [...new Set([...enabled.bash, ...enabled.pwsh])].map((g) => [g, forGroup(g)]),
);

function chr(...codes: number[]): string {
  return String.fromCharCode(...codes);
}

// The launcher under test sanitizes stdin: bash through sanitize, pwsh through Sanitize.
function sanitize(launcher: Launcher, input: string): string {
  const r = runLib(
    launcher,
    { bash: 'sanitize', pwsh: '[Console]::Out.Write((Sanitize ([Console]::In.ReadToEnd())))' },
    { input },
  );
  expect(r.status).toBe(0);
  return r.stdout;
}

describe.each(forGroup('core'))('core ($name)', (launcher) => {
  it('1. no verb and an unknown verb exit 2 with usage; --capabilities prints core', () => {
    const w = makeWorld();
    for (const args of [[], ['frobnicate']]) {
      const r = run(launcher, args, { env: envOf(launcher, w) });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('Usage: geldar-play new|setup|play|resolve|archive|status');
    }
    const caps = run(launcher, ['--capabilities'], { env: envOf(launcher, w) });
    expect(caps.stdout.split('\n')).toContain('core');
  }, 60_000);

  it('2. __prepare is an unknown verb without GELDAR_INTERNAL=1', () => {
    const w = makeWorld();
    const off = run(launcher, ['__prepare', 'abc', 'play'], {
      env: envOf(launcher, w, { GELDAR_INTERNAL: '' }),
    });
    expect(off.status).toBe(2);
    expect(off.stderr).toContain('That is not a command.');
    const on = run(launcher, ['__prepare', 'abc', 'play'], { env: envOf(launcher, w) });
    expect(on.stderr).not.toContain('Usage:');
    expect(on.stderr).not.toContain('That is not a command.');
  }, 60_000);

  it('3. sanitize replaces controls, keeps text, drops exactly one trailing newline', () => {
    const esc = chr(0x1b);
    expect(sanitize(launcher, `ok${esc}[2J${chr(7)}hidden${chr(9)}x`)).toBe('ok [2J hidden x');
    expect(sanitize(launcher, `a${chr(0x9b)}b`)).toBe('a b');
    const keep = `${chr(0x20ac)}${chr(0xe9)}${chr(0x4e2d)}`;
    expect(sanitize(launcher, keep)).toBe(keep);
    expect(sanitize(launcher, `a${chr(13, 10)}b\n`)).toBe('a  b');
    expect(sanitize(launcher, 'x\n\n')).toBe('x ');
  }, 60_000);

  it('4. valid_player_id', () => {
    const cases = ['mmpr-red', 'Red', 'a', '1abc', '../x', 'a b', 'a'.repeat(40)];
    const r = runLib(
      launcher,
      {
        bash: 'while IFS= read -r v; do if valid_player_id "$v"; then echo ok; else echo no; fi; done',
        pwsh: "foreach ($v in [Console]::In.ReadToEnd().Split([char]10)) { if ($v -eq '') { continue }; if (Test-PlayerId $v) { 'ok' } else { 'no' } }",
      },
      { input: `${cases.join('\n')}\n` },
    );
    expect(r.stdout.trim().split(/\r?\n/)).toEqual(['ok', 'no', 'no', 'no', 'no', 'no', 'no']);
  }, 60_000);

  it('4b. valid_player_id rejects an id with a trailing newline', () => {
    const r = runLib(launcher, {
      bash: `if valid_player_id $'abc
'; then echo ok; else echo no; fi`,
      pwsh: "if (Test-PlayerId \"abc`n\") { 'ok' } else { 'no' }",
    });
    expect(r.stdout.trim()).toBe('no');
  }, 60_000);

  it('5. one launch per player: a live lock refuses, a release frees, a dead lock is kept', async () => {
    const w = makeWorld();
    const scripts = {
      bash: 'lock_acquire "$ID"; echo ready; read x',
      pwsh: "try { Lock-Acquire $env:ID; 'ready'; [void][Console]::In.ReadLine() } finally { Lock-Release }",
    };
    const lockEnv = (id: string) => envOf(launcher, w, { ID: id });
    // runLib builds the command line; spawn the same one for the long-lived first holder.
    const spawnHolder = () => {
      if (launcher.name === 'bash') {
        const lib2 = bashPath(join(repoRoot, 'launcher', 'lib', 'common.sh'));
        return spawn(bashExe as string, ['-c', `. '${lib2}'; ${scripts.bash}`], {
          env: childEnv(lockEnv('abc')),
          stdio: 'pipe',
        });
      }
      const dir = join(repoRoot, 'launcher').replace(/'/g, "''");
      const pre = `$ErrorActionPreference = 'Stop'; $GP_DIR = '${dir}'; . (Join-Path $GP_DIR 'lib/common.ps1'); Import-Messages; `;
      return spawn('pwsh', ['-NoProfile', '-Command', pre + scripts.pwsh], {
        env: childEnv(lockEnv('abc')),
        stdio: 'pipe',
      });
    };
    const first = spawnHolder();
    await new Promise<void>((ok, fail) => {
      first.stdout.on('data', (d: Buffer) => d.toString().includes('ready') && ok());
      first.on('error', fail);
      first.on('close', () => fail(new Error('first process ended early')));
    });
    const second = runLib(launcher, scripts, { env: lockEnv('abc'), input: '' });
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('abc is already running');
    first.stdin.end('\n');
    await new Promise((ok) => first.on('close', ok));
    const third = runLib(launcher, scripts, { env: lockEnv('abc'), input: '\n' });
    expect(third.status).toBe(0);
    expect(third.stdout).toContain('ready');
    // A lock left by a dead process is not stolen.
    mkdirSync(join(w.state, 'dead', 'lock'), { recursive: true });
    writeFileSync(join(w.state, 'dead', 'lock', 'pid'), '999999\n');
    const dead = runLib(launcher, scripts, { env: lockEnv('dead'), input: '\n' });
    expect(dead.status).toBe(1);
    expect(dead.stderr).toContain('dead is already running');
    expect(dead.stderr).toContain('remove the folder');
    expect(existsSync(join(w.state, 'dead', 'lock'))).toBe(true);
  }, 60_000);

  it('6. GELDAR_DOCKER is honored', () => {
    const w = makeWorld();
    const r = run(launcher, ['play', 'abc'], { env: envOf(launcher, w) });
    expect(w.calls().some((c) => c[0] === 'compose' && c[1] === 'version')).toBe(true);
    expect(r.stderr).toContain('No player named abc');
    const gone = run(launcher, ['play', 'abc'], {
      env: envOf(launcher, w, { GELDAR_DOCKER: join(w.root, 'no-such-docker') }),
    });
    expect(gone.status).toBe(1);
    expect(gone.stderr).toContain('docker is needed and was not found');
  }, 60_000);

  it('9. --cli: codex is refused, other values are usage errors, claude is accepted', () => {
    const w = makeWorld();
    const codex = run(launcher, ['play', 'abc', '--cli', 'codex'], { env: envOf(launcher, w) });
    expect(codex.status).toBe(1);
    expect(codex.stderr).toContain('Codex is not available yet');
    expect(w.calls()).toEqual([]);
    const bogus = run(launcher, ['play', 'abc', '--cli', 'bogus'], { env: envOf(launcher, w) });
    expect(bogus.status).toBe(2);
    expect(bogus.stderr).toContain('Usage:');
    const claude = run(launcher, ['play', 'abc', '--cli', 'claude'], { env: envOf(launcher, w) });
    expect(claude.stderr).toContain('No player named abc');
    expect(claude.stderr).not.toContain('Usage:');
  }, 60_000);

  timingIt(
    '10. test-only variables have no effect without GELDAR_INTERNAL=1',
    () => {
      const names = [
        'GELDAR_TEST_HOOK_AFTER_CLEAN',
        'GELDAR_SLEEP',
        'GELDAR_KEEP_PROXY_LOG',
        'GELDAR_TMUX',
        'GELDAR_WT',
        'GELDAR_EXTRA_COMPOSE',
        'GELDAR_UNSAFE_IMAGE',
        'GELDAR_PRIVATE_SHARDS_TEST',
        'GELDAR_HELPER_TIMEOUT_SEC',
        'GELDAR_TOOL_PATH',
        'GELDAR_STUB_X',
      ];
      const env: Record<string, string> = {};
      for (const n of names) env[n] = 'value';
      const scripts = {
        bash: `for n in ${names.join(' ')}; do printf '[%s]' "$(gp_env "$n")"; done`,
        pwsh: `foreach ($n in '${names.join("','")}') { [Console]::Out.Write('[' + (Get-GatedEnv $n) + ']') }`,
      };
      expect(runLib(launcher, scripts, { env }).stdout).toBe(names.map(() => '[]').join(''));
      expect(runLib(launcher, scripts, { env: { ...env, GELDAR_INTERNAL: '1' } }).stdout).toBe(
        names.map(() => '[value]').join(''),
      );
      // The same names are never read directly in the launcher code.
      const direct = new RegExp(
        `\\$(?:env:)?\\{?(${names.map((n) => n.replace('_X', '_')).join('|')})`,
      );
      for (const f of launcher.name === 'bash' ? sources : psSources)
        expect(
          text(f)
            .split('\n')
            .filter((l) => direct.test(l)),
        ).toEqual([]);
      // GELDAR_TOOL_PATH does not change the prerequisite checks.
      const w = makeWorld();
      const empty = join(w.root, 'empty');
      mkdirSync(empty);
      const tp = run(launcher, ['play', 'abc'], {
        env: envOf(launcher, w, {
          GELDAR_INTERNAL: '',
          GELDAR_TOOL_PATH: launcher.name === 'bash' ? bashPath(empty) : empty,
        }),
      });
      expect(tp.stderr).toContain('No player named abc');
      expect(tp.stderr).not.toContain('is needed and was not found');
      // GELDAR_HELPER_TIMEOUT_SEC does not shorten run_bounded.
      const t = (internal: string) =>
        runLib(
          launcher,
          {
            bash: 'run_bounded 60 sleep 8; echo "rc=$?"',
            pwsh: '$rc = Invoke-Bounded 60 sleep 8; "rc=$rc"',
          },
          { env: { GELDAR_INTERNAL: internal, GELDAR_HELPER_TIMEOUT_SEC: '1' } },
        ).stdout.trim();
      expect(t('')).toBe('rc=0');
      expect(t('1')).toBe('rc=124');
      // GELDAR_UNSAFE_IMAGE alone does not unlock a tag-form image (the image rules arrive with
      // the pwsh pre-session packet; until then this part runs for bash).
      if (launcher.name !== 'bash') return;
      const img = (internal: string) =>
        runBash('. "$LIB"; resolve_kit_image "x@sha256:$D"; echo "image=$GP_IMAGE"', {
          env: {
            LIB: lib,
            D: 'a'.repeat(64),
            GELDAR_KIT_IMAGE: 'geldar-kit:dev',
            GELDAR_UNSAFE_IMAGE: '1',
            GELDAR_INTERNAL: internal,
          },
        });
      const refused = img('');
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain('not pinned by digest, so it was not used');
      const unsafe = img('1');
      expect(unsafe.stderr).toContain('geldar-play: UNSAFE:');
      expect(unsafe.stdout).toContain('image=geldar-kit:dev');
    },
    60_000,
  );

  it('11. prerequisites per verb, with the hint text', () => {
    const w = makeWorld();
    const needs: Record<string, string[]> = {
      new: ['docker', 'git', 'perl', 'gh'],
      archive: ['docker', 'git', 'perl', 'gh'],
      play: ['docker', 'git', 'tar', 'perl'],
      setup: ['docker', 'git', 'tar', 'perl'],
      resolve: ['docker', 'git', 'perl'],
      status: ['git'],
    };
    const hints: Record<string, string> = {
      docker: 'Install Docker with Compose v2.',
      git: 'Install git 2.40 or newer.',
      tar: 'Install tar (Windows 10 and later include it).',
      perl: 'Install perl (it comes with Git for Windows).',
      gh: 'Install the GitHub CLI (gh) to create or archive a player.',
    };
    const realTools: Record<string, string> = {};
    const shims = (tools: string[], gitVersion?: string) => {
      const dir = join(w.root, `tools-${tools.join('-')}-${gitVersion ?? 'real'}`);
      mkdirSync(dir, { recursive: true });
      for (const t of tools) {
        let real = realTools[t];
        if (real === undefined) {
          real = runBash(`command -v ${t}`).stdout.trim();
          realTools[t] = real;
        }
        const fake = t === 'git' && gitVersion;
        const body = fake ? `echo "git version ${gitVersion}"` : `exec "${real}" "$@"`;
        writeFileSync(join(dir, t), `#!/bin/sh\n${body}\n`);
        chmodSync(join(dir, t), 0o755);
        if (win) {
          // pwsh on Windows runs only .cmd or .exe files.
          const winReal = runBash(`cygpath -w "${real}"`).stdout.trim();
          const cmd = fake ? `@echo git version ${gitVersion}` : `@"${winReal}" %*`;
          writeFileSync(join(dir, `${t}.cmd`), `${cmd}\r\n`);
        }
      }
      return launcher.name === 'bash' ? bashPath(dir) : dir;
    };
    const all = ['git', 'perl', 'tar'];
    const base = (toolPath: string) => {
      const env: Record<string, string> = { ...envOf(launcher, w), GELDAR_TOOL_PATH: toolPath };
      const gh = join(w.fakeDir, win ? 'docker.cmd' : 'docker');
      env.GELDAR_GH = launcher.name === 'bash' ? bashPath(join(w.fakeDir, 'docker')) : gh;
      delete env.GELDAR_GIT;
      return env;
    };
    const args = (v: string) => (v === 'status' ? [v] : [v, 'abc']);
    for (const [verb, list] of Object.entries(needs)) {
      const ok = run(launcher, args(verb), { env: base(shims(all)) });
      // Positive: the verb got past the tool check and ran its own logic.
      if (verb === 'status') {
        expect(ok.status, verb).toBe(0);
      } else if (verb === 'new') {
        expect(ok.status, verb).toBe(1);
        expect(ok.stderr, verb).toMatch(/world address|Nothing was created/);
      } else {
        expect(ok.status, verb).toBe(1);
        expect(ok.stderr, verb).toContain('No player named abc');
      }
      expect(ok.stderr, verb).not.toContain('is needed and was not found');
      expect(ok.stderr, verb).not.toContain('is too old');
      for (const tool of list) {
        const env = base(shims(all.filter((t) => t !== tool)));
        if (tool === 'docker') env.GELDAR_DOCKER = join(w.root, 'missing');
        if (tool === 'gh') env.GELDAR_GH = join(w.root, 'missing');
        const r = run(launcher, args(verb), { env });
        expect(r.status, `${verb} without ${tool}`).toBe(1);
        expect(r.stderr, `${verb} without ${tool}`).toContain(
          `${tool} is needed and was not found. ${hints[tool]}`,
        );
      }
    }
    const old = run(launcher, ['status'], { env: base(shims(all, '2.39.5')) });
    expect(old.status).toBe(1);
    expect(old.stderr).toContain('git 2.39 is too old');
    const fine = run(launcher, ['status'], { env: base(shims(all, '2.40.0')) });
    expect(fine.status).toBe(0);
    expect(fine.stderr).not.toContain('is too old');
    expect(fine.stderr).not.toContain('is needed and was not found');
  }, 180_000);

  it('12. --capabilities lists exactly the enabled groups', () => {
    const w = makeWorld();
    const r = run(launcher, ['--capabilities'], { env: envOf(launcher, w) });
    const got = new Set(r.stdout.split('\n').filter(Boolean));
    const want = new Set<string>(['core', ...(enabled[launcher.name] as string[])]);
    expect(got).toEqual(want);
  }, 60_000);

  it('15. the fake workspace-init role runs the launcher script and builds a clean repo', () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'abc' });
    const session = join(w.root, 'session');
    mkdirSync(session);
    git(p.clone, ['bundle', 'create', join(session, 'start.bundle'), 'refs/heads/main']);
    const script =
      'git clone --no-local --no-hardlinks -c core.autocrlf=false -b "$GELDAR_BRANCH" /in/start.bundle /tmp/c && cp -a /tmp/c/. /player/ && git -C /player remote remove origin';
    const r = runBash(
      `sh "$FD" run --rm --label geldar.role=workspace-init --cap-drop ALL --security-opt no-new-privileges -e HOME=/tmp -e GELDAR_BRANCH=main -v "$S:/in:ro" -v geldar-ws-abc:/player img sh -c "$SCRIPT"`,
      { env: { ...w.env, FD: fakeDockerSh, S: bashPath(session), SCRIPT: script } },
    );
    expect(r.stderr).not.toContain('fake docker');
    expect(r.status).toBe(0);
    const vol = join(w.dockerRoot, 'vol', 'geldar-ws-abc');
    expect(git(vol, ['remote'])).toBe('');
    expect(git(vol, ['status', '--porcelain'])).toBe('');
    expect(git(vol, ['rev-list', '--count', 'HEAD'])).toBe('2');
  }, 60_000);
});

describe('core (files)', () => {
  it('7. every message key used in the code is in a messages.d row, once', () => {
    const rows = tsvFiles.flatMap((f) =>
      text(f)
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('\t')[0] as string),
    );
    expect(new Set(rows).size).toBe(rows.length);
    const used = new Set<string>();
    for (const f of sources) {
      for (const line of text(f).split('\n')) {
        if (/^\s*#/.test(line)) continue;
        for (const m of line.matchAll(/(?:^|[\s;&|(])say\s+([a-z][a-z0-9_]+)/g))
          used.add(m[1] as string);
        for (const m of line.matchAll(/(?:^|[\s;&|(])die\s+\d+\s+([a-z][a-z0-9_]+)/g)) {
          used.add(m[1] as string);
        }
      }
    }
    expect(used.size).toBeGreaterThan(5);
    for (const key of used) expect(rows, key).toContain(key);
  }, 60_000);

  it('8. fake docker: unknown things fail loudly, volumes behave', () => {
    const w = makeWorld();
    const script = [
      'sh "$FD" bogus; echo "bogus=$?"',
      'sh "$FD" volume create x > /dev/null; sh "$FD" volume inspect x > /dev/null; echo "inspect=$?"',
      'sh "$FD" volume rm x; sh "$FD" volume inspect x 2>/dev/null; echo "gone=$?"',
      'sh "$FD" run --rm --bogus-flag --label geldar.role=workspace-init --cap-drop ALL --security-opt no-new-privileges img true; echo "flag=$?"',
      'sh "$FD" run --rm --label geldar.role=nope --cap-drop ALL --security-opt no-new-privileges img true; echo "role=$?"',
    ].join('\n');
    const r = runBash(script, { env: { ...w.env, FD: fakeDockerSh } });
    expect(r.stdout.trim().split('\n')).toEqual([
      'bogus=99',
      'inspect=0',
      'gone=1',
      'flag=99',
      'role=99',
    ]);
  }, 60_000);

  it('13. bash 3.2 floor: no newer bash features', () => {
    const banned = [
      /declare\s+-A/,
      /\bmapfile\b/,
      /\breadarray\b/,
      /\$\{[A-Za-z_0-9]+(\^\^?|,,?)/,
      /&>>/,
      /\|&/,
      /\[\[\s+-v\b/,
      /local\s+-n\b/,
      /\bcoproc\b/,
      /read\s+-N\b/,
      /;&/,
    ];
    for (const f of sources) {
      for (const re of banned) expect(text(f), `${f} ${re}`).not.toMatch(re);
    }
  }, 60_000);

  it('launchers: bash is present, and a missing shell is a failure in CI', () => {
    const names = launchers.map((l) => l.name);
    if (!ciRequiresShells(process.env.CI)) {
      // Locally a missing shell is skipped visibly, never passed vacuously.
      if (!names.includes('bash'))
        console.warn('SKIPPED: bash is missing, bash groups did not run');
      if (!names.includes('pwsh'))
        console.warn('SKIPPED: pwsh is missing, pwsh groups did not run');
      return;
    }
    expect(names).toContain('bash');
    if (existsSync(join(repoRoot, 'launcher', 'geldar-play.ps1'))) expect(names).toContain('pwsh');
    for (const g of Object.keys(groupLaunchers)) {
      expect(groupLaunchers[g]?.length, `group ${g} has no launcher in CI`).toBeGreaterThan(0);
    }
  }, 60_000);

  it('the CI guard fires for any truthy CI and not for empty, 0 or false', () => {
    for (const v of ['true', '1', 'yes', 'TRUE']) expect(ciRequiresShells(v), v).toBe(true);
    for (const v of [undefined, '', '0', 'false'])
      expect(ciRequiresShells(v), String(v)).toBe(false);
  }, 60_000);
});
