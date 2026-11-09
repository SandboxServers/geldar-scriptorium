// corpus: MB-07
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot, SQUID_IMAGE } from './docker.ts';

type Settings = {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
};

function load(relative: string): Settings {
  return JSON.parse(readFileSync(resolve(repoRoot, relative), 'utf8')) as Settings;
}

const managed = load('image/settings/managed.json');
const play = load('image/settings/play.json');
const setup = load('image/settings/setup.json');
const managedDeny = managed.permissions?.deny ?? [];
const playDeny = play.permissions?.deny ?? [];

describe('image managed and play settings', () => {
  it('managed denies Read, Edit and Write of the CLI home, as a glob and as the directory', () => {
    for (const tool of ['Read', 'Edit', 'Write']) {
      expect(managedDeny).toContain(`${tool}(//cli-home/**)`);
      expect(managedDeny).toContain(`${tool}(//cli-home)`);
    }
  }, 120_000);

  it('managed still denies Bash, WebFetch, WebSearch and the credentials files', () => {
    for (const rule of [
      'Bash',
      'WebFetch',
      'WebSearch',
      'Read(**/.credentials.json)',
      'Edit(**/.credentials.json)',
      'Write(**/.credentials.json)',
    ]) {
      expect(managedDeny).toContain(rule);
    }
  }, 120_000);

  it('play denies Edit and Write of identity.md, relative and absolute', () => {
    for (const tool of ['Edit', 'Write']) {
      expect(playDeny).toContain(`${tool}(/memory/identity.md)`);
      expect(playDeny).toContain(`${tool}(//player/memory/identity.md)`);
    }
  }, 120_000);

  it('neither managed nor play widens permissions with an allow list', () => {
    expect(managed.permissions?.allow).toBeUndefined();
    expect(play.permissions?.allow).toBeUndefined();
  }, 120_000);

  it('every deny rule is a bare tool name or Tool(pattern)', () => {
    const pattern = /^[A-Za-z_*]+(\(.+\))?$/;
    for (const rule of [...managedDeny, ...playDeny, ...(setup.permissions?.deny ?? [])]) {
      expect(rule, rule).toMatch(pattern);
    }
  }, 120_000);

  it('the Squid pin carries a full sha256 digest', () => {
    expect(SQUID_IMAGE).toMatch(/^ubuntu\/squid(:[^@]+)?@sha256:[0-9a-f]{64}$/);
  }, 120_000);
});
