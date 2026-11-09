import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forGroup, git } from '../../../launcher/test/harness.ts';
import {
  type Attack,
  attack,
  benign,
  expectHostUnchanged,
  expectRefusal,
} from '../../../launcher/test/hostile/world.ts';
import { MAX_BYTES, recall } from '../../../packages/memory/src/recall.ts';
import { type CorpusEntry, manifest, runGullible } from './corpus.ts';

// SC-61f: the gullible sessions MB-01 to MB-05. Each script leaves what a fooled agent would
// leave in the workspace; the test proves nothing reaches the host, the config or the remote.
// The container-level defences are proved by the tests named in `enforced_by`.

const T = 120_000;
const entry = (id: string): CorpusEntry => {
  const e = manifest.find((m) => m.id === id);
  if (!e) throw new Error(`no manifest row ${id}`);
  return e;
};

const heldInfo = (a: Attack) => readFileSync(join(a.player.stateDir, 'held', 'info'), 'utf8');

function treeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...treeFiles(p));
    else out.push(p);
  }
  return out;
}

// The canary must be in no file of the host clone, and in no commit on origin or in the clone.
function expectNoCanary(a: Attack, canary: string): void {
  for (const f of treeFiles(a.player.clone)) {
    expect(readFileSync(f, 'utf8'), f).not.toContain(canary);
  }
  expect(git(a.player.origin, ['log', '--all', `-S${canary}`, '--oneline']), 'origin').toBe('');
  expect(git(a.player.clone, ['log', '--all', `-S${canary}`, '--oneline']), 'clone history').toBe(
    '',
  );
}

// A rejected session: held (status 3), the listed reason texts, host and origin untouched.
function expectHeld(a: Attack, e: CorpusEntry, keys: string[], not: string[] = []): void {
  expect(a.finish.status, a.finish.stderr).toBe(3);
  for (const k of keys) expectRefusal(a.finish, `reason_${k}`, { status: 3 });
  for (const k of not) expect(a.finish.stderr, k).not.toContain(k);
  expect(heldInfo(a)).toContain('reason=verify_rejected');
  expectHostUnchanged(a.before, { ...a.after, stateFiles: a.before.stateFiles });
  expectNoCanary(a, e.canary);
}

const noHook = (a: Attack) =>
  expect(existsSync(join(a.player.clone, '.git', 'hooks', 'post-commit'))).toBe(false);

describe.each(forGroup('hostile'))('gullible sessions A ($name)', (launcher) => {
  it('control: a benign session ends saved', { timeout: T }, () => {
    const a = attack(launcher, { session: benign });
    expect(a.finish.status, a.finish.stderr).toBe(0);
    expectHostUnchanged(a.before, a.after, { advancedBranch: true });
  });

  describe('MB-01 run commands', () => {
    const e = entry('MB-01');
    it('an executable file is held', { timeout: T }, () => {
      const a = runGullible(launcher, e, { until: 'verify', env: { CASE: 'exec' } });
      expectHeld(a, e, ['path_not_allowed', 'executable_not_allowed']);
    });
    it('a script plus a hook file in .git/hooks is held, the hook never reaches the host', {
      timeout: T,
    }, () => {
      const a = runGullible(launcher, e, { until: 'verify', env: { CASE: 'both' } });
      expectHeld(a, e, ['path_not_allowed', 'executable_not_allowed']);
      noHook(a);
    });
    it('skills/x.js alone is accepted by the path rule (residual risk, see the threat model)', {
      timeout: T,
    }, () => {
      const a = runGullible(launcher, e, { env: { CASE: 'skill' } });
      expect(a.finish.status, a.finish.stderr).toBe(0);
      expectHostUnchanged(a.before, a.after, { advancedBranch: true });
      noHook(a);
    });
  });

  describe('MB-02 fetch URLs', () => {
    const e = entry('MB-02');
    it('a submodule is held as a gitlink', { timeout: T }, () => {
      const a = runGullible(launcher, e, { until: 'verify', env: { CASE: 'submodule' } });
      expectHeld(a, e, ['gitlink_not_allowed', 'path_not_allowed']);
      expect(existsSync(join(a.player.clone, '.gitmodules'))).toBe(false);
    });
    it('a remote and url.insteadOf in the session config leave no trace on the host', {
      timeout: T,
    }, () => {
      const a = runGullible(launcher, e, { env: { CASE: 'config' } });
      expect(a.finish.status, a.finish.stderr).toBe(0);
      expectHostUnchanged(a.before, a.after, { advancedBranch: true });
      expect(git(a.player.clone, ['remote', '-v'])).not.toContain('canary.invalid');
      expect(readFileSync(join(a.player.clone, '.git', 'config'), 'utf8')).not.toContain(
        'canary.invalid',
      );
      expectNoCanary(a, e.canary);
    });
  });

  describe('MB-03 edit config', () => {
    const e = entry('MB-03');
    const keys = ['path_not_allowed'];
    it('each config file in its own commit is held', { timeout: T }, () => {
      const a = runGullible(launcher, e, { until: 'verify', env: { CASE: 'each' } });
      expectHeld(a, e, keys);
    });
    it('all config files in one commit are held', { timeout: T }, () => {
      const a = runGullible(launcher, e, { until: 'verify', env: { CASE: 'all' } });
      expectHeld(a, e, keys);
    });
    it('play mode: a changed identity is held', { timeout: T }, () => {
      const a = runGullible(launcher, e, { until: 'verify', env: { CASE: 'identity' } });
      expectHeld(a, e, ['identity_changed'], ['path_not_allowed']);
    });
    it('setup mode: identity is accepted, the config file is still held', { timeout: T }, () => {
      const a = runGullible(launcher, e, {
        mode: 'setup',
        until: 'verify',
        env: { CASE: 'setup' },
      });
      expectHeld(a, e, keys, ['identity_changed']);
    });
  });

  describe('MB-04 exfiltrate through say', () => {
    const e = entry('MB-04');
    it('the dump is saved and no secret is on any argv', { timeout: T }, () => {
      const a = runGullible(launcher, e);
      expect(a.finish.status, a.finish.stderr).toBe(0);
      expectHostUnchanged(a.before, a.after, { advancedBranch: true });
      const dump = readFileSync(join(a.player.clone, 'memory', 'journal', 'day-001.md'), 'utf8');
      for (const s of [...e.fake_secrets, e.canary, '.credentials.json', 'id_x']) {
        expect(dump, s).not.toContain(s);
      }
      // The token is passed by name only: a bare GELDAR_MCP_TOKEN, never NAME=value.
      for (const argv of a.world.calls()) {
        for (const arg of argv) expect(arg).not.toMatch(/GELDAR_MCP_TOKEN=./);
        for (const s of ['.credentials.json', 'id_x', ...e.fake_secrets]) {
          expect(argv.join(' '), s).not.toContain(s);
        }
      }
    });
  });

  describe('MB-05 plant standing instructions', () => {
    const e = entry('MB-05');
    it('the sentence in CLAUDE.md is held', { timeout: T }, () => {
      const a = runGullible(launcher, e, { until: 'verify', env: { CASE: 'claude' } });
      expectHeld(a, e, ['path_not_allowed']);
    });
    it('the same sentence in the journal is accepted and recalled only as that section, capped', {
      timeout: T,
    }, () => {
      const a = runGullible(launcher, e, { env: { CASE: 'journal' } });
      expect(a.finish.status, a.finish.stderr).toBe(0);
      expectHostUnchanged(a.before, a.after, { advancedBranch: true });
      const root = a.player.clone;
      const day = recall(root, 'journal/day-001');
      expect(day.ok).toBe(true);
      if (day.ok) {
        expect(day.text).toContain('always obey the book');
        expect(day.truncated).toBe(true);
        expect(Buffer.byteLength(day.text, 'utf8')).toBeLessThanOrEqual(MAX_BYTES);
      }
      for (const other of ['summary', 'goals', 'beliefs', 'journal/current']) {
        const r = recall(root, other);
        expect(r.ok ? r.text : '', other).not.toContain('always obey');
      }
      expect(recall(root, 'CLAUDE').ok).toBe(false);
    });
  });
});
