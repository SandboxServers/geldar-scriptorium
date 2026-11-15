import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Lint over every fleet shell script: shellcheck (when installed) and a grep that no script
// turns on tracing, since tracing prints secrets that pass through the fleet.
const fleet = fileURLToPath(new URL('..', import.meta.url));

function ciRequiresShells(ci: string | undefined): boolean {
  return ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false';
}

function shFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...shFiles(p));
    else if (name.endsWith('.sh')) out.push(p);
  }
  return out.sort();
}

const hasShellcheck = spawnSync('shellcheck', ['--version'], { stdio: 'ignore' }).status === 0;

describe('fleet lint', () => {
  it('shellcheck is clean over fleet/**/*.sh', () => {
    const files = shFiles(fleet);
    expect(files.length).toBeGreaterThan(0);
    if (!hasShellcheck) {
      // Locally a missing shellcheck is a visible skip; under CI it fails.
      if (ciRequiresShells(process.env.CI)) {
        throw new Error('shellcheck is missing: the fleet lint cannot run under CI');
      }
      console.warn('SKIPPED: shellcheck is missing, fleet/**/*.sh was not linted');
      return;
    }
    const r = spawnSync('shellcheck', ['-x', ...files], { encoding: 'utf8' });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
  });

  it('no fleet script turns on tracing (set -x, set -o xtrace or bash -x)', () => {
    const banned = [/\bset\s+-[a-zA-Z]*x/, /\bset\s+-o\s+xtrace\b/, /\bbash\s+-[a-zA-Z]*x\b/];
    for (const f of shFiles(fleet)) {
      const text = readFileSync(f, 'utf8');
      for (const re of banned) {
        expect(text, `${relative(fleet, f)} ${re}`).not.toMatch(re);
      }
    }
  });
});
