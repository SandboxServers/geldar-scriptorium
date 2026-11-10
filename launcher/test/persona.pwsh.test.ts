import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { bashExe, bashPath, git, launchers, makeWorld, repoRoot, run } from './harness.ts';
import { personaSuite } from './persona-suite.ts';

// SC-74c: new --persona-dir in the PowerShell launcher.

const pwsh = launchers.find((l) => l.name === 'pwsh');
const win = process.platform === 'win32';
const ID = 'ag-jason-01';
const fakeGh = bashPath(join(repoRoot, 'launcher', 'test', 'fake-gh.sh'));

if (pwsh) {
  personaSuite(pwsh);

  describe('persona-dir with a token file (pwsh)', () => {
    it('honours both the persona and the token', () => {
      vi.setConfig({ testTimeout: 180_000 });
      const l = pwsh;
      const w = makeWorld();
      const shareDir = join(w.root, 'share');
      mkdirSync(join(shareDir, 'config'), { recursive: true });
      writeFileSync(join(shareDir, 'config', 'world.conf'), 'mcp_base=\nprivate_only_shards=\n');
      writeFileSync(join(w.fakeDir, 'gh'), `#!/bin/sh\nexec sh "${fakeGh}" "$@"\n`);
      chmodSync(join(w.fakeDir, 'gh'), 0o755);
      if (win && bashExe)
        writeFileSync(join(w.fakeDir, 'gh.cmd'), `@"${bashExe}" "${fakeGh}" %*\r\n`);
      writeFileSync(
        join(w.root, 'gitconfig'),
        '[user]\n\tname = Host\n\temail = host@example.test\n[init]\n\tdefaultBranch = main\n',
      );
      const mem = join(w.root, 'persona', ID, 'memory');
      mkdirSync(mem, { recursive: true });
      writeFileSync(join(mem, 'identity.md'), '# Identity\n\nI am Jason.\n');
      writeFileSync(join(mem, 'goals.md'), '# Goals\n\nLead.\n');
      const tok = join(w.root, 'tok');
      writeFileSync(tok, 'abcdefghijklmnop1234\n');
      const r = run(
        l,
        [
          'new',
          ID,
          '--mock',
          'http://world.test',
          '--token-file',
          tok,
          '--persona-dir',
          join(w.root, 'persona'),
        ],
        {
          env: {
            ...w.env,
            ...w.envPwsh,
            GELDAR_GH: join(w.fakeDir, win ? 'gh.cmd' : 'gh'),
            GELDAR_SHARE: shareDir,
            GELDAR_SLEEP: '0',
            FAKE_GH_ROOT: bashPath(join(w.root, 'gh')),
            FAKE_GH_TEMPLATE: bashPath(join(repoRoot, 'template')),
          },
          timeoutMs: 120_000,
        },
      );
      expect(r.status, r.stderr).toBe(0);
      const clone = join(w.players, `player-${ID}`);
      expect(git(clone, ['log', '-1', '--format=%s']).trim()).toBe(`birth: ${ID}`);
      expect(readFileSync(join(clone, 'memory', 'goals.md'), 'utf8')).toBe('# Goals\n\nLead.\n');
      const token = join(w.state, ID, 'token');
      expect(existsSync(token)).toBe(true);
      expect(readFileSync(token, 'utf8')).toBe('abcdefghijklmnop1234\n');
    });
  });
}
