import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forGroup, git, makePlayer, makeWorld, run } from '../harness.ts';
import { attack, benign, expectNoDockerCall, expectRefusal } from './world.ts';

// H-19 (T-19): kit_image must be pinned by digest. GELDAR_KIT_IMAGE with a tag is refused unless
// both GELDAR_INTERNAL=1 and GELDAR_UNSAFE_IMAGE=1 are set, and then every run prints UNSAFE:.

const T = 60_000;
const digest = (c: string, n = 64) => c.repeat(n);
const ok = `registry.test/geldar-kit@sha256:${digest('a')}`;

const ROWS: [string, string][] = [
  ['a tag', 'registry.test/geldar-kit:1.0'],
  ['latest', 'registry.test/geldar-kit:latest'],
  ['an uppercase repository', `Registry.test/Geldar-Kit@sha256:${digest('a')}`],
  ['a short digest', `registry.test/geldar-kit@sha256:${digest('a', 12)}`],
  ['a digest plus a trailing space and a flag', `${ok} --privileged`],
  ['credentials in the name', `u:p@registry.test/i@sha256:${digest('a')}`],
  ['a raw newline', `${ok}\n--privileged`],
  ['an escaped newline', `${ok}\\n--privileged`],
];

function withImage(w: ReturnType<typeof makeWorld>, image: string) {
  const p = makePlayer(w, { id: 'abc' });
  const gitEnv = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
  const f = join(p.clone, 'player.json');
  writeFileSync(
    f,
    readFileSync(f, 'utf8').replace(/"kit_image": "[^"]*"/, () => `"kit_image": "${image}"`),
  );
  git(p.clone, ['commit', '-am', 'hostile image'], gitEnv);
  git(p.clone, ['push', 'origin', 'main'], gitEnv);
  return p;
}

describe.each(forGroup('hostile'))('H-19 kit image ($name)', (launcher) => {
  it.each(ROWS)('refuses %s with no docker call', { timeout: T }, (_label, image) => {
    const w = makeWorld();
    withImage(w, image);
    const env = launcher.name === 'bash' ? w.env : w.envPwsh;
    const r = run(launcher, ['__prepare', 'abc', 'play'], { env, timeoutMs: T });
    expectRefusal(r, 'bad_player_json', { status: 1 });
    expectNoDockerCall(w);
  });

  it('GELDAR_KIT_IMAGE with a tag and no internal variable is image_refused', {
    timeout: T,
  }, () => {
    const w = makeWorld();
    makePlayer(w, { id: 'abc' });
    const env = {
      ...(launcher.name === 'bash' ? w.env : w.envPwsh),
      GELDAR_INTERNAL: '',
      GELDAR_KIT_IMAGE: 'registry.test/geldar-kit:dev',
      GELDAR_UNSAFE_IMAGE: '1',
    };
    const r = run(launcher, ['play', 'abc'], { env, timeoutMs: T });
    expectRefusal(r, 'image_refused', { status: 1 });
    expectNoDockerCall(w);
  });

  it('GELDAR_KIT_IMAGE with a tag and only GELDAR_INTERNAL=1 is still image_refused', {
    timeout: T,
  }, () => {
    const w = makeWorld();
    makePlayer(w, { id: 'abc' });
    const env = {
      ...(launcher.name === 'bash' ? w.env : w.envPwsh),
      GELDAR_KIT_IMAGE: 'registry.test/geldar-kit:dev',
    };
    const r = run(launcher, ['__prepare', 'abc', 'play'], { env, timeoutMs: T });
    expectRefusal(r, 'image_refused', { status: 1 });
    expectNoDockerCall(w);
  });

  it('with both variables it runs and prints the UNSAFE: line on every run', {
    timeout: 240_000,
  }, () => {
    const tag = 'registry.test/geldar-kit:dev';
    const a = attack(launcher, {
      session: benign,
      env: { GELDAR_KIT_IMAGE: tag, GELDAR_UNSAFE_IMAGE: '1' },
    });
    expect(a.finish.status, a.finish.stderr).toBe(0);
    for (const [name, r] of [
      ['prepare', a.prepare],
      ['session', a.session],
      ['finish', a.finish],
    ] as const) {
      expect(r.stderr, `UNSAFE: line missing from ${name}`).toContain('UNSAFE:');
    }
    expect(a.world.calls().some((c) => c.includes(tag))).toBe(true);
  });
});
