import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, launchers, makePlayer, makeWorld, repoRoot, run, runLib } from '../harness.ts';
import { urlSuite } from '../mcp-url-suite.ts';
import { expectNoDockerCall, expectRefusal } from './world.ts';

// SC-60n (N3): the pwsh launcher refuses local and private names in mcp_url and base URLs.

const pwsh = launchers.find((l) => l.name === 'pwsh');
const T = 60_000;

if (pwsh) {
  urlSuite(pwsh);

  describe('N3 refusals (pwsh)', () => {
    it('refuses a path segment of ..', () => {
      const lib = join(repoRoot, 'launcher', 'lib', 'player.ps1').replace(/'/g, "''");
      const r = runLib(pwsh, {
        bash: '',
        pwsh: `. '${lib}'; foreach ($u in 'https://a.example.com/p/../x','https://a.example.com/p/..') { if (Test-McpUrl $u) { 'ok' } else { 'no' } }`,
      });
      expect(r.stdout.split(/\r?\n/).filter(Boolean)).toEqual(['no', 'no']);
    });

    it('new --mock http://localhost is bad_url', { timeout: T }, () => {
      const w = makeWorld();
      const r = run(pwsh, ['new', 'abc', '--mock', 'http://localhost'], {
        env: w.envPwsh,
        timeoutMs: T,
      });
      expectRefusal(r, 'bad_url', { status: 1 });
      expectNoDockerCall(w);
    });

    it('a player.json with a host.docker.internal mcp_url is bad_player_json', {
      timeout: T,
    }, () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      const gitEnv = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
      const f = join(p.clone, 'player.json');
      const text = readFileSync(f, 'utf8').replace(
        /"mcp_url": "[^"]*"/,
        '"mcp_url": "https://host.docker.internal/p/x"',
      );
      writeFileSync(f, text);
      git(p.clone, ['commit', '-am', 'private url'], gitEnv);
      git(p.clone, ['push', 'origin', 'main'], gitEnv);
      const r = run(pwsh, ['__prepare', 'abc', 'play'], { env: w.envPwsh, timeoutMs: T });
      expectRefusal(r, 'bad_player_json', { status: 1 });
      expectNoDockerCall(w);
    });
  });
}
