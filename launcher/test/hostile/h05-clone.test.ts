import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forGroup, git, makePlayer, makeWorld, run } from '../harness.ts';

// SC-60c, H-05 (T-05): the workspace is cloned inside the container from start.bundle, never
// from the host clone, so nothing planted in the host clone's .git reaches it. A regression guard.
const T = 120_000;

describe.each(forGroup('hostile'))('H-05 clone ($name)', (launcher) => {
  it('planted hooks, insteadOf, hooksPath and pushurl do not reach the workspace', {
    timeout: T,
  }, () => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'abc' });
    const genv = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
    const hooks = join(p.clone, '.git', 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\ntouch "$0.ran"\n');
    chmodSync(join(hooks, 'pre-commit'), 0o755);
    git(p.clone, ['config', 'url.https://evil.test/.insteadOf', 'ghp:'], genv);
    git(p.clone, ['config', 'core.hooksPath', hooks], genv);
    git(p.clone, ['config', 'remote.origin.pushurl', join(w.root, 'push-target')], genv);
    const r = run(launcher, ['__prepare', 'abc', 'play'], {
      env: launcher.name === 'bash' ? w.env : w.envPwsh,
      timeoutMs: T,
    });
    expect(r.status, r.stderr).toBe(0);
    // The helper ran (the workspace is a clone at START), so the checks below are not vacuous.
    const ws = join(w.dockerRoot, 'vol', 'geldar-ws-abc');
    expect(git(ws, ['rev-parse', 'HEAD'])).toBe(git(p.clone, ['rev-parse', 'HEAD']));
    expect(existsSync(join(ws, '.git', 'hooks', 'pre-commit'))).toBe(false);
    expect(existsSync(join(ws, '.git', 'objects', 'info', 'alternates'))).toBe(false);
    expect(git(ws, ['remote'])).toBe('');
    const cfg = readFileSync(join(ws, '.git', 'config'), 'utf8');
    for (const bad of ['insteadOf', 'hooksPath', 'pushurl', 'evil.test', 'push-target']) {
      expect(cfg.toLowerCase(), bad).not.toContain(bad.toLowerCase());
    }
    // No host path: the unique temp directory name is in every host path of this world.
    expect(cfg).not.toContain(basename(w.root));
    expect(existsSync(`${join(hooks, 'pre-commit')}.ran`)).toBe(false);
  });
});
