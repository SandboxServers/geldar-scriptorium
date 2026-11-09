import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forGroup, git, makePlayer, makeWorld, run } from '../harness.ts';
import { attack, benign, expectNoDockerCall, expectRefusal } from './world.ts';

// H-08 (T-08): an mcp_url host that would widen the Squid allowlist is refused before any file is
// written; a valid URL yields a file that is exactly the host and one newline.

const T = 60_000;

// [label, the whole mcp_url as written into player.json text (JSON escapes applied by the test)]
const ROWS: [string, string][] = [
  ['encoded newline', 'https://a.example.com%0Aevil.com/mcp'],
  ['raw newline', 'https://a.example.com\nevil.com/mcp'],
  ['escaped newline', 'https://a.example.com\\nevil.com/mcp'],
  ['leading dot', 'https://.example.com/mcp'],
  ['wildcard', 'https://*.example.com/mcp'],
  ['uppercase', 'https://A.Example.com/mcp'],
  ['trailing dot', 'https://a.example.com./mcp'],
  ['userinfo', 'https://user:pw@a.example.com/mcp'],
  ['space', 'https://a.example.com evil.com/mcp'],
  ['tab', 'https://a.example.com\tevil.com/mcp'],
  ['comma host', 'https://a.example.com,evil.com/mcp'],
];

function allowlistFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[]).filter((f) =>
    String(f).endsWith('allowlist-world.txt'),
  );
}

describe.each(forGroup('hostile'))('H-08 allowlist ($name)', (launcher) => {
  it.each(ROWS)('refuses %s before any file is written', { timeout: T }, (_label, url) => {
    const w = makeWorld();
    const p = makePlayer(w, { id: 'abc' });
    const gitEnv = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
    const f = join(p.clone, 'player.json');
    // Written as raw text so a real newline or tab lands in the file as the attacker would.
    const text = readFileSync(f, 'utf8').replace(/"mcp_url": "[^"]*"/, () => `"mcp_url": "${url}"`);
    writeFileSync(f, text);
    git(p.clone, ['commit', '-am', 'hostile url'], gitEnv);
    git(p.clone, ['push', 'origin', 'main'], gitEnv);
    const env = launcher.name === 'bash' ? w.env : w.envPwsh;
    const r = run(launcher, ['__prepare', 'abc', 'play'], { env, timeoutMs: T });
    expectRefusal(r, 'bad_player_json', { status: 1 });
    expect(allowlistFiles(p.stateDir)).toEqual([]);
    expectNoDockerCall(w);
  });

  it('a valid url gives a file that is exactly the host and one newline', {
    timeout: 240_000,
  }, () => {
    const a = attack(launcher, {
      session: `cp "$GELDAR_WORLD_ALLOWLIST" "$ALLOWLIST_MARK.content"\n${benign}`,
    });
    expect(a.finish.status, a.finish.stderr).toBe(0);
    expect(a.allowlistPath.endsWith('allowlist-world.txt')).toBe(true);
    expect(a.allowlistSeen).toBe(true);
    const content = readFileSync(join(a.world.dockerRoot, 'allowlist.mark.content'), 'utf8');
    expect(content).toBe('mcp.registry.test\n');
  });
});
