import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bashPath, type Launcher, repoRoot, runLib } from './harness.ts';

export interface PortCase {
  base: string;
  port: string;
  url: string;
  ok: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
export const portCases = JSON.parse(
  readFileSync(join(here, 'mcp-port-cases.json'), 'utf8'),
) as PortCase[];

// One temp share dir per row, holding only that row's world.conf. The shipped file is never read.
function makeShare(c: PortCase): string {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-mcp-port-'));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'config', 'world.conf'), `mcp_base=${c.base}\nmcp_port=${c.port}\n`);
  return dir;
}

const quote = (s: string) => s.replace(/'/g, "''");

// Runs every row through the launcher's own URL check in one process and compares with the table.
export function mcpPortSuite(launcher: Launcher): void {
  describe(`mcp_port table (${launcher.name})`, () => {
    it('agrees with the shared table on every row', () => {
      const dirs = portCases.map(makeShare);
      try {
        let r: ReturnType<typeof runLib>;
        if (launcher.name === 'bash') {
          const lib = bashPath(join(repoRoot, 'launcher', 'lib', 'player.sh'));
          const rows = portCases.map(
            (c, i) =>
              `export GELDAR_SHARE='${bashPath(dirs[i])}'; if valid_mcp_url '${c.url}'; then echo ok; else echo no; fi`,
          );
          r = runLib(launcher, { bash: `. '${lib}'; ${rows.join('; ')}`, pwsh: '' });
        } else {
          const lib = quote(join(repoRoot, 'launcher', 'lib', 'player.ps1'));
          const rows = portCases.map(
            (c, i) =>
              `$env:GELDAR_SHARE = '${quote(dirs[i])}'; if (Test-McpUrl '${quote(c.url)}') { 'ok' } else { 'no' }`,
          );
          r = runLib(launcher, { bash: '', pwsh: `. '${lib}'; ${rows.join('; ')}` });
        }
        expect(r.status, r.stderr).toBe(0);
        const got = r.stdout.split(/\r?\n/).filter(Boolean);
        const lines = portCases.map(
          (c, i) =>
            `${c.base} ${c.port} ${c.url} -> ${got[i]}${got[i] === (c.ok ? 'ok' : 'no') ? '' : ' MISMATCH'}`,
        );
        expect(got.length).toBe(portCases.length);
        expect(lines.filter((l) => l.endsWith('MISMATCH'))).toEqual([]);
      } finally {
        for (const d of dirs) rmSync(d, { recursive: true, force: true });
      }
    });
  });
}
