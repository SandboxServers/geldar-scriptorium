import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchers, repoRoot, runLib } from '../harness.ts';

// SC-60s: the git seam as a .cmd shim receives hostile arguments byte for byte through
// Invoke-Git and Invoke-GitRaw (the re-check); cmd.exe never reads one as syntax.

const pwsh = launchers.find((l) => l.name === 'pwsh');
const win = process.platform === 'win32';
const T = 120_000;
const fwd = (p: string) => p.replace(/\\/g, '/');
const q = (p: string) => fwd(p).replace(/'/g, "''");

const NAMES = ['a&b', 'x%TEMP%y', 'a^b', 'a!b', 'a (b) c', 'a & echo x > pwned.txt'];

describe.skipIf(!win || !pwsh)('git .cmd shim arguments (win32)', () => {
  it('delivers hostile arguments byte for byte; no side file', { timeout: T }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-cmdgit-'));
    const rec = join(dir, 'rec.mjs');
    writeFileSync(
      rec,
      "import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.REC_OUT, `${JSON.stringify(process.argv.slice(2))}\n`);\n",
    );
    writeFileSync(join(dir, 'git.cmd'), `@node "${fwd(rec)}" %*\r\n`);
    const work = join(dir, 'work');
    mkdirSync(work);
    const out = join(dir, 'out.jsonl');
    const values = NAMES.map((n) => `${fwd(work)}/${n}`);
    writeFileSync(join(dir, 'values.json'), JSON.stringify(values));
    const body = [
      `. '${q(join(repoRoot, 'launcher', 'lib', 'recheck.ps1'))}'`,
      `$env:GELDAR_GIT = '${q(join(dir, 'git.cmd'))}'`,
      `$env:GELDAR_STATE_DIR = '${q(join(dir, 'state'))}'`,
      `$env:REC_OUT = '${q(out)}'`,
      `$vals = Get-Content -LiteralPath '${q(join(dir, 'values.json'))}' -Raw | ConvertFrom-Json`,
      'foreach ($v in $vals) {',
      '  Invoke-Git -C $v status | Out-Null',
      "  [void](Invoke-GitRaw @('-C', $v, 'status'))",
      '}',
    ].join('\n');
    if (!pwsh) throw new Error('no pwsh');
    const r = runLib(pwsh, { bash: '', pwsh: body }, { cwd: work, timeoutMs: T });
    expect(r.status, r.stderr).toBe(0);
    const got = readFileSync(out, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[]);
    // each call: -c core.hooksPath=<dir> then the arguments
    expect(got.map((a) => a.slice(2))).toEqual(
      values.flatMap((v) => [0, 1].map(() => ['-C', v, 'status'])),
    );
    expect(existsSync(join(work, 'pwned.txt'))).toBe(false);
  });
});
