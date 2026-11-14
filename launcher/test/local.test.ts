import { mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bashPath, forGroup, git, type Launcher, repoRoot, run, runLib } from './harness.ts';
import { MOCK, ID as NEW_ID, newRun, setupWorld } from './new-support.ts';
import {
  composeCalls,
  composeEnvs,
  ENDPOINT_KEY,
  expectClean,
  ID,
  LOGIN,
  setup,
  T,
} from './player-support.ts';

// Every GELDAR_LOCAL_* name the launcher exports for a local player.
const LOCAL_NAMES = [
  'GELDAR_LOCAL_BASE_URL',
  'GELDAR_LOCAL_API_KEY',
  'GELDAR_LOCAL_CONTEXT_TOKENS',
  'GELDAR_LOCAL_IMAGES',
];

const bashLibs = `GP_DIR='${bashPath(join(repoRoot, 'launcher'))}'; for f in "$GP_DIR"/lib/*.sh; do . "$f"; done; `;
// Skips common.ps1: re-sourcing it would reset the message table that runLib's prelude loaded.
const pwshLibs =
  "foreach ($f in (Get-ChildItem (Join-Path $GP_DIR 'lib') -Filter '*.ps1' | Where-Object { $_.Name -ne 'common.ps1' } | Sort-Object Name)) { . $f.FullName }; ";

// Commits a change to the player's player.json in the clone (the launcher reads the committed text).
function commitPlayer(clone: string, change: (p: Record<string, unknown>) => void) {
  const file = join(clone, 'player.json');
  const player = JSON.parse(readFileSync(file, 'utf8'));
  change(player);
  writeFileSync(file, `${JSON.stringify(player, null, 2)}\n`);
  git(clone, ['add', 'player.json']);
  git(clone, [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '-qm',
    'select local',
  ]);
}

// Stores the model server's address and key in the player's state folder, as local-endpoint will.
function storeEndpoint(stateDir: string, url = 'http://host.docker.internal:11434/v1') {
  mkdirSync(join(stateDir, 'local'), { recursive: true });
  writeFileSync(join(stateDir, 'local', 'base-url'), `${url}\n`);
  writeFileSync(join(stateDir, 'local', 'api-key'), `${ENDPOINT_KEY}\n`, { mode: 0o600 });
}

const localPlayer = (p: Record<string, unknown>) => {
  p.harness = 'local';
  p.declared_model = 'local-model';
  p.context_tokens = 8192;
  p.images = false;
};

// The start verb through the launcher's own functions (bash sources them, pwsh dot-sources them).
const startLocal = (l: Launcher, s: ReturnType<typeof setup>) =>
  runLib(
    l,
    {
      bash: `${bashLibs}verb_start "$TEST_PLAYER_ID"`,
      pwsh: `${pwshLibs}Verb-start $env:TEST_PLAYER_ID`,
    },
    { env: { ...s.env, TEST_PLAYER_ID: ID } },
  );

describe.each(forGroup('new'))('local model launch ($name)', (l) => {
  it('creates a seeded local player with the context and image settings', { timeout: T }, () => {
    const s = setupWorld();
    const persona = join(s.w.root, 'persona');
    mkdirSync(join(persona, NEW_ID, 'memory'), { recursive: true });
    writeFileSync(join(persona, NEW_ID, 'memory/identity.md'), '# Identity\nI am a wanderer.\n');
    writeFileSync(join(persona, NEW_ID, 'memory/goals.md'), '# Goals\nLearn about this place.\n');
    const r = newRun(l, s, [
      NEW_ID,
      '--cli',
      'local',
      '--mock',
      MOCK,
      '--persona-dir',
      l.name === 'bash' ? bashPath(persona) : persona,
    ]);
    expect(r.status, r.stderr).toBe(0);
    const player = JSON.parse(
      readFileSync(join(s.w.players, `player-${NEW_ID}`, 'player.json'), 'utf8'),
    );
    expect(player.harness).toBe('local');
    expect(player.declared_model).toBe('');
    expect(player.context_tokens).toBe(8192);
    expect(player.images).toBe(false);
    expect(r.stderr).toContain(`local-endpoint ${NEW_ID}`);
  });

  it('refuses an unseeded local birth before creating a remote repository', { timeout: T }, () => {
    const s = setupWorld();
    const r = newRun(l, s, [NEW_ID, '--cli', 'local', '--mock', MOCK]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--persona-dir');
    expect(s.ghCalls()).toEqual([]);
  });

  it('refuses --cli local on play before any launch', { timeout: T }, () => {
    const s = setup(l);
    const r = s.go('play', ID, '--cli', 'local');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Local models use persistent players');
    expect(composeCalls(s.w, 'up')).toHaveLength(0);
  });

  it('starts a local player with the endpoint in the compose environment only', {
    timeout: T,
  }, () => {
    // A stored login is present: a local player must not receive it (only a claude player does).
    const s = setup(l);
    commitPlayer(s.p.clone, localPlayer);
    storeEndpoint(s.p.stateDir);
    const r = startLocal(l, s);
    expect(r.status, r.stderr).toBe(0);
    expect(composeCalls(s.w, 'up')).toHaveLength(1);
    const env = composeEnvs(s.w).at(-1);
    expect(env?.GELDAR_HARNESS).toBe('local');
    expect(env?.GELDAR_LOCAL_BASE_URL).toBe('http://host.docker.internal:11434/v1');
    expect(env?.GELDAR_LOCAL_API_KEY).toBe(ENDPOINT_KEY);
    expect(env?.GELDAR_LOCAL_CONTEXT_TOKENS).toBe('8192');
    expect(env?.GELDAR_LOCAL_IMAGES).toBe('false');
    expect(env?.GELDAR_RUN_MODEL).toBe('local-model');
    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
    expect(JSON.stringify(env)).not.toContain(LOGIN);
    // The key is in the compose environment only: expectClean fails if it reaches an argument or output.
    expectClean(s.w, r);
  });

  it('an ambient GELDAR_LOCAL_* variable is not forwarded to compose for a claude player', {
    timeout: T,
  }, () => {
    const s = setup(l);
    const ambient = Object.fromEntries(LOCAL_NAMES.map((n) => [n, `AMBIENT-${n}`]));
    const r = run(l, ['start', ID], { env: { ...s.env, ...ambient } });
    expect(r.status, r.stderr).toBe(0);
    expect(composeCalls(s.w, 'up')).toHaveLength(1);
    const env = composeEnvs(s.w).at(-1) ?? {};
    expect(env.GELDAR_HARNESS).toBe('claude');
    for (const n of LOCAL_NAMES) expect(env).not.toHaveProperty(n);
    expect(r.stdout + r.stderr).not.toContain('AMBIENT-');
  });

  it('the endpoint key is masked in the logs output', { timeout: T }, () => {
    const s = setup(l, { login: false });
    commitPlayer(s.p.clone, localPlayer);
    storeEndpoint(s.p.stateDir);
    writeFileSync(join(s.w.dockerRoot, 'compose-logs.txt'), `keeper | key ${ENDPOINT_KEY}\n`);
    const r = s.go('logs', ID);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('keeper | key [masked]');
    expectClean(s.w, r);
  });

  it('refuses a base-url that is a link before any docker call', { timeout: T }, (ctx) => {
    const s = setup(l, { login: false });
    commitPlayer(s.p.clone, localPlayer);
    storeEndpoint(s.p.stateDir);
    const base = join(s.p.stateDir, 'local', 'base-url');
    const real = join(s.w.root, 'real-base-url');
    writeFileSync(real, 'http://host.docker.internal:11434/v1\n');
    unlinkSync(base);
    try {
      symlinkSync(real, base, 'file');
    } catch {
      ctx.skip();
    }
    const r = startLocal(l, s);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('local-endpoint');
    expect(composeCalls(s.w, 'up')).toHaveLength(0);
  });

  it('refuses an empty base-url before any docker call', { timeout: T }, () => {
    const s = setup(l, { login: false });
    commitPlayer(s.p.clone, localPlayer);
    storeEndpoint(s.p.stateDir);
    writeFileSync(join(s.p.stateDir, 'local', 'base-url'), '');
    const r = startLocal(l, s);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('local-endpoint');
    expect(composeCalls(s.w, 'up')).toHaveLength(0);
  });

  it('a nested-only images key is bad_player_json, not a crash', { timeout: T }, () => {
    const s = setup(l, { login: false });
    commitPlayer(s.p.clone, (p) => {
      localPlayer(p);
      delete p.images;
      p.nested = { images: false };
    });
    storeEndpoint(s.p.stateDir);
    const r = startLocal(l, s);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('is not valid (images)');
    expect(composeCalls(s.w, 'up')).toHaveLength(0);
  });

  it('a player.json without context_tokens is bad_player_json', { timeout: T }, () => {
    // local_no_context in pl_ready is a defensive branch: read_local_fields refuses first.
    const s = setup(l, { login: false });
    commitPlayer(s.p.clone, (p) => {
      localPlayer(p);
      delete p.context_tokens;
    });
    storeEndpoint(s.p.stateDir);
    const r = startLocal(l, s);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('is not valid (context_tokens)');
    expect(composeCalls(s.w, 'up')).toHaveLength(0);
  });

  it('refuses a missing model before any docker call', { timeout: T }, () => {
    const s = setup(l, { login: false });
    commitPlayer(s.p.clone, (p) => {
      localPlayer(p);
      p.declared_model = '';
    });
    storeEndpoint(s.p.stateDir);
    const r = runLib(
      l,
      {
        bash: `${bashLibs}verb_start "$TEST_PLAYER_ID"`,
        pwsh: `${pwshLibs}Verb-start $env:TEST_PLAYER_ID`,
      },
      { env: { ...s.env, TEST_PLAYER_ID: ID } },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('declared_model');
    expect(composeCalls(s.w, 'up')).toHaveLength(0);
  });

  it('refuses a missing endpoint before any docker call', { timeout: T }, () => {
    const s = setup(l, { login: false });
    commitPlayer(s.p.clone, localPlayer);
    const r = runLib(
      l,
      {
        bash: `${bashLibs}verb_start "$TEST_PLAYER_ID"`,
        pwsh: `${pwshLibs}Verb-start $env:TEST_PLAYER_ID`,
      },
      { env: { ...s.env, TEST_PLAYER_ID: ID } },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('local-endpoint');
    expect(composeCalls(s.w, 'up')).toHaveLength(0);
  });

  // 500 is refused by the bash digit pattern; 1023, 2000001 and 9999999 match it and fail the range.
  it.each([500, 1023, 2000001, 9999999])(
    'refuses an out-of-range context_tokens (%i) in the committed player.json',
    { timeout: T },
    (ctxTokens) => {
      const s = setup(l, { login: false });
      commitPlayer(s.p.clone, (p) => {
        localPlayer(p);
        p.context_tokens = ctxTokens;
      });
      storeEndpoint(s.p.stateDir);
      const r = startLocal(l, s);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('context_tokens');
      expect(composeCalls(s.w, 'up')).toHaveLength(0);
    },
  );
});
