import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { bashExe, bashPath, launchers, makeWorld, repoRoot, run } from './harness.ts';
import { personaSuite } from './persona-suite.ts';

const fakeGh = bashPath(join(repoRoot, 'launcher', 'test', 'fake-gh.sh'));
const win = process.platform === 'win32';
const ID = 'ag-jason-01';

for (const l of launchers.filter((x) => x.name === 'bash')) {
  personaSuite(l);

  it('honours a token file together with the persona', () => {
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
    writeFileSync(join(mem, 'identity.md'), '# Identity\n\nI am an invented test person.\n');
    writeFileSync(join(mem, 'goals.md'), '# Goals\n\nBe invented.\n');
    const tok = join(w.root, 'token.txt');
    writeFileSync(tok, 'invented-token-0123456789\n');
    const env = {
      ...w.env,
      GELDAR_GH: bashPath(join(w.fakeDir, 'gh')),
      GELDAR_SHARE: bashPath(shareDir),
      GELDAR_SLEEP: '0',
      FAKE_GH_ROOT: bashPath(join(w.root, 'gh')),
      FAKE_GH_TEMPLATE: bashPath(join(repoRoot, 'template')),
      GIT_AUTHOR_NAME: 'Host',
      GIT_AUTHOR_EMAIL: 'host@example.test',
      GIT_COMMITTER_NAME: 'Host',
      GIT_COMMITTER_EMAIL: 'host@example.test',
    };
    const r = run(
      l,
      [
        'new',
        ID,
        '--mock',
        'http://world.test',
        '--token-file',
        bashPath(tok),
        '--persona-dir',
        bashPath(join(w.root, 'persona')),
      ],
      { env, timeoutMs: 120_000 },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(w.state, ID, 'token'), 'utf8').trim()).toBe(
      'invented-token-0123456789',
    );
    expect(existsSync(join(w.players, `player-${ID}`, 'memory', 'goals.md'))).toBe(true);
  });
}
