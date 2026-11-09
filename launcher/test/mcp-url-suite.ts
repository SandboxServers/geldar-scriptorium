import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bashPath, type Launcher, repoRoot, runLib } from './harness.ts';

export interface UrlCase {
  url: string;
  ok: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
export const urlCases = JSON.parse(
  readFileSync(join(here, 'mcp-url-cases.json'), 'utf8'),
) as UrlCase[];

// Runs every row through the launcher's own URL check in one process and compares with the table.
export function urlSuite(launcher: Launcher): void {
  describe(`mcp_url table (${launcher.name})`, () => {
    it('agrees with the shared table on every row', () => {
      const urls = urlCases.map((c) => c.url);
      let r: ReturnType<typeof runLib>;
      if (launcher.name === 'bash') {
        const lib = bashPath(join(repoRoot, 'launcher', 'lib', 'player.sh'));
        const list = urls.map((u) => `'${u}'`).join(' ');
        r = runLib(launcher, {
          bash: `. '${lib}'; for u in ${list}; do if valid_mcp_url "$u"; then echo ok; else echo no; fi; done`,
          pwsh: '',
        });
      } else {
        const lib = join(repoRoot, 'launcher', 'lib', 'player.ps1').replace(/'/g, "''");
        const list = urls.map((u) => `'${u.replace(/'/g, "''")}'`).join(',');
        r = runLib(launcher, {
          bash: '',
          pwsh: `. '${lib}'; foreach ($u in @(${list})) { if (Test-McpUrl $u) { 'ok' } else { 'no' } }`,
        });
      }
      expect(r.status, r.stderr).toBe(0);
      const got = r.stdout.split(/\r?\n/).filter(Boolean);
      const lines = urlCases.map(
        (c, i) => `${c.url} -> ${got[i]}${got[i] === (c.ok ? 'ok' : 'no') ? '' : ' MISMATCH'}`,
      );
      expect(got.length).toBe(urlCases.length);
      expect(lines.filter((l) => l.endsWith('MISMATCH'))).toEqual([]);
    });
  });
}
