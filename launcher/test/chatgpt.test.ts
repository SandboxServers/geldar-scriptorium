import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bashPath, forGroup, git, repoRoot, runLib } from './harness.ts';
import { MOCK, ID as NEW_ID, newRun, setupWorld } from './new-support.ts';
import { composeCalls, composeEnvs, ID, setup, T } from './player-support.ts';

const bashLibs = `GP_DIR='${bashPath(join(repoRoot, 'launcher'))}'; for f in "$GP_DIR"/lib/*.sh; do . "$f"; done; `;
const pwshLibs =
  "foreach ($f in (Get-ChildItem (Join-Path $GP_DIR 'lib') -Filter '*.ps1' | Sort-Object Name)) { . $f.FullName }; ";

describe.each(forGroup('new'))('ChatGPT subscription launch ($name)', (l) => {
  it('creates a seeded ChatGPT player without inheriting the Claude model default', {
    timeout: T,
  }, () => {
    const s = setupWorld();
    const persona = join(s.w.root, 'persona');
    mkdirSync(join(persona, NEW_ID, 'memory'), { recursive: true });
    writeFileSync(join(persona, NEW_ID, 'memory/identity.md'), '# Identity\nI am a wanderer.\n');
    writeFileSync(join(persona, NEW_ID, 'memory/goals.md'), '# Goals\nLearn about this place.\n');
    const r = newRun(l, s, [
      NEW_ID,
      '--cli',
      'chatgpt',
      '--mock',
      MOCK,
      '--persona-dir',
      l.name === 'bash' ? bashPath(persona) : persona,
    ]);
    expect(r.status, r.stderr).toBe(0);
    const player = JSON.parse(
      readFileSync(join(s.w.players, `player-${NEW_ID}`, 'player.json'), 'utf8'),
    );
    expect(player.harness).toBe('chatgpt');
    expect(player.declared_model).toBe('');
    expect(r.stderr).toContain(`chatgpt-login ${NEW_ID}`);
  });

  it('refuses an unseeded ChatGPT birth before creating a remote repository', {
    timeout: T,
  }, () => {
    const s = setupWorld();
    const r = newRun(l, s, [NEW_ID, '--cli', 'chatgpt', '--mock', MOCK]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--persona-dir');
    expect(s.ghCalls()).toEqual([]);
  });

  it('constructs login with loopback-only callback, isolated vendor volume and no credentials or workspace mounts', () => {
    const r = runLib(l, {
      bash: `${bashLibs}PL_KIT_IMAGE=kit-test; docker_cmd() { printf "%s\\n" "$@"; }; chatgpt_container player-test login`,
      pwsh: `${pwshLibs}$script:PL_KIT_IMAGE = "kit-test"; function Invoke-Docker { $args | ForEach-Object { [Console]::Out.Write("$_\u0060n") } }; Invoke-ChatGPTContainer player-test login`,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.split(/\r?\n/)).toEqual(
      expect.arrayContaining([
        '127.0.0.1:1455:1455',
        'geldar-cli-player-test-chatgpt:/cli-home',
        '--cap-drop',
        'ALL',
        '--read-only',
        'geldar-chatgpt',
        'login',
      ]),
    );
    expect(r.stdout).not.toMatch(/\/player|TOKEN|API_KEY|privileged|docker.sock/);
  });

  it('dispatches a persistent ChatGPT player without requiring or passing a Claude login', {
    timeout: T,
  }, () => {
    const s = setup(l, { login: false });
    const file = join(s.p.clone, 'player.json');
    const player = JSON.parse(readFileSync(file, 'utf8'));
    player.harness = 'chatgpt';
    player.declared_model = 'account-model';
    writeFileSync(file, `${JSON.stringify(player, null, 2)}\n`);
    git(s.p.clone, ['add', 'player.json']);
    git(s.p.clone, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-qm',
      'select ChatGPT',
    ]);
    // The existing fake does not implement the new login command. Substitute only this model-free
    // status probe; the real launcher still validates the repo, key, token and compose environment.
    const r = runLib(
      l,
      {
        bash: `${bashLibs}chatgpt_ready() { return 0; }; verb_start "$TEST_PLAYER_ID"`,
        pwsh: `${pwshLibs}function Test-ChatGPTReady { return $true }; Verb-start $env:TEST_PLAYER_ID`,
      },
      { env: { ...s.env, TEST_PLAYER_ID: ID } },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(composeCalls(s.w, 'up')).toHaveLength(1);
    const env = composeEnvs(s.w).at(-1);
    expect(env?.GELDAR_HARNESS).toBe('chatgpt');
    expect(env?.GELDAR_RUN_MODEL).toBe('account-model');
    expect(env?.CLAUDE_CODE_OAUTH_TOKEN ?? '').toBe('');
  });
});
