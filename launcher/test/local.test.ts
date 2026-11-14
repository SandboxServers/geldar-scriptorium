import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bashPath, forGroup, git, repoRoot, runLib } from './harness.ts';
import { MOCK, ID as NEW_ID, newRun, setupWorld } from './new-support.ts';
import {
  composeCalls,
  composeEnvs,
  ENDPOINT_KEY,
  expectClean,
  ID,
  setup,
  T,
} from './player-support.ts';

const bashLibs = `GP_DIR='${bashPath(join(repoRoot, 'launcher'))}'; for f in "$GP_DIR"/lib/*.sh; do . "$f"; done; `;
const pwshLibs =
  "foreach ($f in (Get-ChildItem (Join-Path $GP_DIR 'lib') -Filter '*.ps1' | Sort-Object Name)) { . $f.FullName }; ";

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
    expect(r.stderr).toContain('local');
    expect(composeCalls(s.w, 'up')).toHaveLength(0);
  });

  it('starts a local player with the endpoint in the compose environment only', {
    timeout: T,
  }, () => {
    const s = setup(l, { login: false });
    commitPlayer(s.p.clone, localPlayer);
    storeEndpoint(s.p.stateDir);
    const r = runLib(
      l,
      {
        bash: `${bashLibs}verb_start "$TEST_PLAYER_ID"`,
        pwsh: `${pwshLibs}Verb-start $env:TEST_PLAYER_ID`,
      },
      { env: { ...s.env, TEST_PLAYER_ID: ID } },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(composeCalls(s.w, 'up')).toHaveLength(1);
    const env = composeEnvs(s.w).at(-1);
    expect(env?.GELDAR_HARNESS).toBe('local');
    expect(env?.GELDAR_LOCAL_BASE_URL).toBe('http://host.docker.internal:11434/v1');
    expect(env?.GELDAR_LOCAL_API_KEY).toBe(ENDPOINT_KEY);
    expect(env?.GELDAR_LOCAL_CONTEXT_TOKENS).toBe('8192');
    expect(env?.GELDAR_LOCAL_IMAGES).toBe('false');
    expect(env?.GELDAR_RUN_MODEL).toBe('local-model');
    expect(env?.CLAUDE_CODE_OAUTH_TOKEN ?? '').toBe('');
    // The key is in the compose environment only: expectClean fails if it reaches an argument or output.
    expectClean(s.w, r);
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

  it('refuses an out-of-range context_tokens in the committed player.json', { timeout: T }, () => {
    const s = setup(l, { login: false });
    commitPlayer(s.p.clone, (p) => {
      localPlayer(p);
      p.context_tokens = 500;
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
    expect(r.stderr).toContain('context_tokens');
    expect(composeCalls(s.w, 'up')).toHaveLength(0);
  });
});
