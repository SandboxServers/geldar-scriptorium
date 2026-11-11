import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// SC-80: rows check the URL shape only, so they run in base mode (no mcp_base binding).
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
          bash: `. '${lib}'; for u in ${list}; do if valid_mcp_url "$u" base; then echo ok; else echo no; fi; done`,
          pwsh: '',
        });
      } else {
        const lib = join(repoRoot, 'launcher', 'lib', 'player.ps1').replace(/'/g, "''");
        const list = urls.map((u) => `'${u.replace(/'/g, "''")}'`).join(',');
        r = runLib(launcher, {
          bash: '',
          pwsh: `. '${lib}'; foreach ($u in @(${list})) { if (Test-McpUrl $u -Base) { 'ok' } else { 'no' } }`,
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

    // The production path: each ok row, checked without base mode against a share whose mcp_base
    // is that row's own scheme and host (and port, when it is not 80 or 443).
    it('accepts every ok row against a world whose mcp_base is its own host', () => {
      const okRows = urlCases.filter((c) => c.ok);
      const dirs = okRows.map((c) => {
        // The rows are not all WHATWG URLs, so split scheme, authority and port by hand.
        const m = /^(https?):\/\/([^/]+)\//.exec(c.url) ?? [];
        const port = /:(\d+)$/.exec(m[2] ?? '')?.[1] ?? '';
        const dir = mkdtempSync(join(tmpdir(), 'geldar-mcp-url-'));
        mkdirSync(join(dir, 'config'));
        writeFileSync(
          join(dir, 'config', 'world.conf'),
          `mcp_base=${m[1]}://${m[2]}\nmcp_port=${port === '80' || port === '443' ? '' : port}\n`,
        );
        return dir;
      });
      try {
        let r: ReturnType<typeof runLib>;
        if (launcher.name === 'bash') {
          const lib = bashPath(join(repoRoot, 'launcher', 'lib', 'player.sh'));
          const rows = okRows.map(
            (c, i) =>
              `export GELDAR_SHARE='${bashPath(dirs[i])}'; if valid_mcp_url '${c.url}'; then echo ok; else echo no; fi`,
          );
          r = runLib(launcher, { bash: `. '${lib}'; ${rows.join('; ')}`, pwsh: '' });
        } else {
          const lib = join(repoRoot, 'launcher', 'lib', 'player.ps1').replace(/'/g, "''");
          const rows = okRows.map(
            (c, i) =>
              `$env:GELDAR_SHARE = '${dirs[i].replace(/'/g, "''")}'; if (Test-McpUrl '${c.url.replace(/'/g, "''")}') { 'ok' } else { 'no' }`,
          );
          r = runLib(launcher, { bash: '', pwsh: `. '${lib}'; ${rows.join('; ')}` });
        }
        expect(r.status, r.stderr).toBe(0);
        const got = r.stdout.split(/\r?\n/).filter(Boolean);
        expect(got.length).toBe(okRows.length);
        expect(okRows.filter((_, i) => got[i] !== 'ok').map((c) => c.url)).toEqual([]);
      } finally {
        for (const d of dirs) rmSync(d, { recursive: true, force: true });
      }
    });
  });
}
