// H-20 (T-20): the credential and tool denies, asserted structurally.
// corpus: MB-04
// corpus: MB-09
//
// Other paths a hostile book names have no rule of their own: ~/.claude/**,
// ~/.claude.json, $HOME forms, /proc/*/environ, ~/.ssh, ~/.config/gh,
// ~/.gitconfig, /etc/claude-code/** and /opt/geldar/**. They are covered by
// blockReadsOutsideWorkingDirectories with the working directory /player.
// There is no offline permission evaluator (tests/image/cli.test.ts only proves
// the CLI accepts the rules), so whether the pinned CLI blocks each spelling is
// checked live in SC-62 (D-SC-01; docs/launcher-hardening.md H-20).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const settingsDir = path.resolve(here, '../../image/settings');

interface Settings {
  permissions?: { deny?: string[]; blockReadsOutsideWorkingDirectories?: boolean };
}

function load(name: string): Settings {
  return JSON.parse(readFileSync(path.join(settingsDir, name), 'utf8')) as Settings;
}

const managed = load('managed.json');
const managedDeny = managed.permissions?.deny ?? [];

const managedRules = [
  'Bash',
  'WebFetch',
  'WebSearch',
  ...['Read', 'Edit'].flatMap((tool) => [
    `${tool}(**/.credentials.json)`,
    `${tool}(//cli-home/**)`,
    `${tool}(//cli-home)`,
  ]),
];

describe('H-20 managed.json denies', () => {
  for (const rule of managedRules) {
    it(`denies ${rule}`, () => {
      expect(managedDeny).toContain(rule);
    });
  }

  it('blocks reads outside the working directory', () => {
    expect(managed.permissions?.blockReadsOutsideWorkingDirectories).toBe(true);
  });
});

describe('H-20 the other settings files, each on its own', () => {
  it('play.json denies the two identity paths', () => {
    expect(load('play.json').permissions?.deny).toEqual(
      expect.arrayContaining(['Edit(/memory/identity.md)', 'Edit(//player/memory/identity.md)']),
    );
  });

  it('setup.json denies mcp__geldar__*', () => {
    expect(load('setup.json').permissions?.deny).toContain('mcp__geldar__*');
  });
});
