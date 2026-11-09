import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bashPath,
  git,
  launchers,
  makePlayer,
  makeWorld,
  repoRoot,
  run,
  runLib,
} from '../harness.ts';
import { urlSuite } from '../mcp-url-suite.ts';
import { expectNoDockerCall, expectRefusal } from './world.ts';

// SC-60m (N3): the bash launcher refuses local and private names in mcp_url and base URLs.

const bash = launchers.find((l) => l.name === 'bash');
const T = 60_000;

if (bash) {
  urlSuite(bash);

  describe('N3 refusals (bash)', () => {
    it('refuses a path segment of ..', () => {
      const lib = bashPath(join(repoRoot, 'launcher', 'lib', 'player.sh'));
      const r = runLib(bash, {
        bash: `. '${lib}'; for u in https://a.example.com/p/../x https://a.example.com/p/..; do if valid_mcp_url "$u"; then echo ok; else echo no; fi; done`,
        pwsh: '',
      });
      expect(r.stdout.split(/\r?\n/).filter(Boolean)).toEqual(['no', 'no']);
    });

    it('new --mock http://localhost is bad_url', { timeout: T }, () => {
      const w = makeWorld();
      const r = run(bash, ['new', 'abc', '--mock', 'http://localhost'], {
        env: w.env,
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
      const r = run(bash, ['__prepare', 'abc', 'play'], { env: w.env, timeoutMs: T });
      expectRefusal(r, 'bad_player_json', { status: 1 });
      expectNoDockerCall(w);
    });
  });
}
