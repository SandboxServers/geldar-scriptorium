import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildKit, dockerReady, KIT_IMAGE, repoRoot, run } from './docker.ts';

const ready = dockerReady();
const dockerfile = readFileSync(resolve(repoRoot, 'image/Dockerfile'), 'utf8');

function inKit(script: string) {
  return run(['run', '--rm', KIT_IMAGE, 'sh', '-c', script], { timeoutMs: 60000 });
}

describe.skipIf(!ready)('kit image build', () => {
  beforeAll(buildKit, 900_000);

  it('claude --version matches the Dockerfile ARG', () => {
    const expected = /^ARG CLAUDE_CODE_VERSION=(\S+)$/m.exec(dockerfile)?.[1];
    expect(expected).toBeTruthy();
    expect(inKit('claude --version').stdout.startsWith(expected as string)).toBe(true);
  }, 120_000);

  it('every FROM is pinned by digest and nothing uses :latest', () => {
    const froms = dockerfile.split('\n').filter((l) => /^FROM\s/.test(l));
    expect(froms.length).toBeGreaterThan(0);
    for (const line of froms.filter((l) => !/^FROM kit\s/.test(l))) {
      expect(line).toMatch(/@sha256:[0-9a-f]{64}/);
    }
    expect(dockerfile).not.toContain(':latest');
  }, 120_000);

  it('git is 2.40 or newer', () => {
    const out = inKit('git --version').stdout;
    const m = /(\d+)\.(\d+)/.exec(out);
    expect(m).toBeTruthy();
    const [major, minor] = [Number(m?.[1]), Number(m?.[2])];
    expect(major > 2 || (major === 2 && minor >= 40)).toBe(true);
  }, 120_000);

  it('libcurl is absent and local git (commit, bundle, clone from a bundle) still works', () => {
    const out = inKit(
      [
        'dpkg -s libcurl3t64-gnutls 2>&1 | head -3',
        'ls /usr/lib/*/libcurl* 2>&1 | head -1',
        'cd /tmp && git init -q -b main r && cd r',
        'git -c user.name=t -c user.email=t@t commit -q --allow-empty -m one',
        'git bundle create ../b.bundle main >/dev/null 2>&1',
        'cd .. && git clone -q -b main b.bundle c && git -C c log --format=%s',
        'git -C r fetch -q ../b.bundle main && echo fetch-ok',
      ].join('; '),
    ).stdout;
    expect(out).not.toContain('Status: install ok installed');
    expect(out).toMatch(/No such file/);
    expect(out).toContain('one');
    expect(out).toContain('fetch-ok');
  }, 120_000);

  it('runs as player in /player by default', () => {
    expect(inKit('id -un; pwd').stdout.trim().split('\n')).toEqual(['player', '/player']);
  }, 120_000);

  it('the real CLI is installed and stub-cli is absent', () => {
    const out = inKit('readlink -f /usr/local/bin/claude; ls /opt/geldar/packages').stdout;
    const [link, ...pkgs] = out.trim().split('\n');
    expect(link).toContain('claude-code');
    expect(pkgs.join(' ')).toBe('git keeper memory path-rule supervisor verify');
    expect(out).not.toContain('stub-cli');
  }, 120_000);

  it('the three companions run', () => {
    expect(inKit('geldar-verify >/dev/null 2>&1; echo $?').stdout.trim()).toBe('2');
    expect(
      inKit('geldar-memory --root /player </dev/null >/dev/null 2>&1; echo $?').stdout.trim(),
    ).toBe('0');
    const git = inKit('geldar-git 2>&1; echo "exit=$?"').stdout;
    expect(git).toMatch(/usage/i);
    expect(git).not.toContain('exit=0');
  }, 120_000);

  it('node matches .nvmrc', () => {
    const want = readFileSync(resolve(repoRoot, '.nvmrc'), 'utf8').trim();
    expect(inKit('node -v').stdout.trim().replace(/^v/, '')).toBe(want);
  }, 120_000);

  it('auto-update is disabled', () => {
    expect(inKit('env').stdout.split('\n')).toContain('DISABLE_AUTOUPDATER=1');
  }, 120_000);
});
