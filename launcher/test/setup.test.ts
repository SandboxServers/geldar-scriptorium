import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bashPath,
  forGroup,
  git,
  type Launcher,
  makePlayer,
  makeWorld,
  repoRoot,
  run,
  type World,
} from './harness.ts';

vi.setConfig({ testTimeout: 180_000 });

const share = bashPath(join(repoRoot, 'image'));
const ID = 'abc';
const PLACEHOLDER = 'Who you are. Written once, at your birth.';

const asPlayer = `export GIT_AUTHOR_NAME=player-${ID} GIT_AUTHOR_EMAIL=player-${ID}@users.noreply.github.com
export GIT_COMMITTER_NAME=player-${ID} GIT_COMMITTER_EMAIL=player-${ID}@users.noreply.github.com
`;

const birth = `printf '# Identity\\n\\nI am Abc, a careful trader.\\n' > memory/identity.md
printf '# Recent days\\n\\nBorn today.\\n' > memory/summary.md
printf '# Goals\\n\\nLearn the market.\\n' > memory/goals.md
git add -A
git commit -q -m birth
`;

const noIdentity = `mkdir -p memory/journal
echo x > memory/journal/day-001.md
git add -A
git commit -q -m day
`;

function prep(l: Launcher, w: World, script: string) {
  const p = makePlayer(w, { id: ID });
  const sf = join(w.root, 'session.sh');
  writeFileSync(sf, `${asPlayer}${script}`);
  const env = {
    ...(l.name === 'bash' ? w.env : w.envPwsh),
    GELDAR_SHARE: share,
    FAKE_SESSION: bashPath(sf),
  };
  const go = (verb: string) => run(l, [verb, ID], { env, timeoutMs: 150_000 });
  return { p, go };
}

const tip = (dir: string) => git(dir, ['rev-parse', 'main']);

// Commits the given identity text (null removes the file) and pushes it.
function setIdentity(clone: string, body: string | null, w: World) {
  const g = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
  const f = join(clone, 'memory', 'identity.md');
  if (body === null) rmSync(f);
  else writeFileSync(f, body);
  git(clone, ['add', '-A'], g);
  git(clone, ['commit', '-m', 'identity'], g);
  git(clone, ['push', 'origin', 'main'], g);
}

describe.each(forGroup('setup'))('setup ($name)', (l) => {
  const noStart = (stateDir: string) => {
    expect(existsSync(join(stateDir, 'start'))).toBe(false);
    expect(existsSync(join(stateDir, 'mode'))).toBe(false);
  };
  const dockerUsed = (w: World) =>
    w.calls().some((c) => c[0] === 'run' || (c[0] === 'compose' && c.includes('run')));

  it('1. the real template identity is unborn and accepted', () => {
    const w = makeWorld();
    const { p, go } = prep(l, w, birth);
    expect(readFileSync(join(p.clone, 'memory', 'identity.md'), 'utf8')).toContain(PLACEHOLDER);
    const r = go('setup');
    expect(r.status, r.stderr).toBe(0);
  });

  it('2. born, empty and missing identities refuse before any docker call', () => {
    for (const body of ['# Identity\n\nI am someone.\n', '', null]) {
      const w = makeWorld();
      const { p, go } = prep(l, w, birth);
      setIdentity(p.clone, body, w);
      const r = go('setup');
      expect(r.status, r.stderr).toBe(1);
      expect(r.stderr).toContain('already has an identity');
      expect(dockerUsed(w)).toBe(false);
      noStart(p.stateDir);
    }
  });

  it('2b. born only after a pull: a stale clone is refused', () => {
    const w = makeWorld();
    const { p, go } = prep(l, w, birth);
    const other = join(w.root, 'other');
    git(w.root, ['clone', p.origin, other], { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') });
    setIdentity(other, '# Identity\n\nI am born.\n', w);
    expect(readFileSync(join(p.clone, 'memory', 'identity.md'), 'utf8')).toContain(PLACEHOLDER);
    const r = go('setup');
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('already has an identity');
    expect(dockerUsed(w)).toBe(false);
    noStart(p.stateDir);
  });

  it('3. a setup session that writes the identity ends with the birth commit on origin', () => {
    const w = makeWorld();
    const { p, go } = prep(l, w, birth);
    const before = tip(p.origin);
    const r = go('setup');
    expect(r.status, r.stderr).toBe(0);
    expect(tip(p.origin)).not.toBe(before);
    expect(git(p.origin, ['log', 'main', '-n', '1', '--format=%s'])).toBe('birth');
    expect(git(p.origin, ['show', 'main:memory/identity.md'])).toContain('I am Abc');
    expect(tip(p.clone)).toBe(tip(p.origin));
  });

  it('4. the same session in play mode is rejected by the gate; nothing is pushed', () => {
    const w = makeWorld();
    const { p, go } = prep(l, w, birth);
    const before = tip(p.origin);
    const r = go('play');
    expect(r.status, r.stderr).not.toBe(0);
    expect(r.stderr).toContain('changed who the player is');
    expect(tip(p.origin)).toBe(before);
  });

  it('5. a setup session that does not write identity ends setup_empty', () => {
    const w = makeWorld();
    const { go } = prep(l, w, noIdentity);
    const r = go('setup');
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('without writing who you are');
  });

  it('6. the harness command is the setup settings and /setup', () => {
    const w = makeWorld();
    const { go } = prep(l, w, birth);
    const r = go('setup');
    expect(r.status, r.stderr).toBe(0);
    const c = w.calls().find((a) => a[0] === 'compose' && a.includes('run'));
    expect(c).toBeDefined();
    expect((c ?? []).join(' ')).toContain('--settings /etc/geldar/settings/setup.json /setup');
  });

  it('7. setup twice: the second refuses', () => {
    const w = makeWorld();
    const { go } = prep(l, w, birth);
    expect(go('setup').status).toBe(0);
    const r = go('setup');
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('already has an identity');
  });
});
