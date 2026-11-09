import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchers, repoRoot, runLib } from '../harness.ts';

// SC-60p (N6): a .cmd shim receives every argument byte for byte; cmd.exe never reads one as syntax.

const pwsh = launchers.find((l) => l.name === 'pwsh');
const win = process.platform === 'win32';
const T = 120_000;
const fwd = (p: string) => p.replace(/\\/g, '/');
const q = (p: string) => fwd(p).replace(/'/g, "''");
const ps = (body: string, cwd?: string) => {
  if (!pwsh) throw new Error('no pwsh');
  return runLib(pwsh, { bash: '', pwsh: body }, { cwd, timeoutMs: T });
};

// The shim never uses echo (it would re-parse & and ^): a node recorder writes argv as JSON lines.
function shim() {
  const dir = mkdtempSync(join(tmpdir(), 'gp-cmd-'));
  const rec = join(dir, 'rec.mjs');
  writeFileSync(
    rec,
    "import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.REC_OUT, `${JSON.stringify(process.argv.slice(2))}\\n`);\n",
  );
  writeFileSync(join(dir, 'shim.cmd'), `@node "${fwd(rec)}" %*\r\n`);
  const work = join(dir, 'work');
  mkdirSync(work);
  return { dir, work, shim: join(dir, 'shim.cmd'), out: join(dir, 'out.jsonl') };
}

const NAMES = [
  'a&b',
  'x%TEMP%y',
  '%TEMP%',
  'a^b',
  'a (b) c',
  'a!b',
  'trail\\',
  'a & echo x > pwned.txt',
];

describe.skipIf(!pwsh)('ConvertTo-CmdArgument', () => {
  it.each([
    ['a double quote', 34],
    ['a CR', 13],
    ['a LF', 10],
    ['a NUL', 0],
  ])('refuses %s with bad_state_path', (_label, code) => {
    const r = ps(`ConvertTo-CmdArgument ('a' + [char]${code} + 'b') | Out-Null`);
    expect(r.status).toBe(1);
  });

  it('closes the quote around each percent and doubles trailing backslashes', () => {
    const r = ps("ConvertTo-CmdArgument 'a%TEMP%b'; ConvertTo-CmdArgument 'c:\\d\\'");
    expect(r.stdout.split(/\r?\n/).filter(Boolean)).toEqual(['"a"%"TEMP"%"b"', '"c:\\d\\\\"']);
  });
});

describe.skipIf(!win || !pwsh)('N6 .cmd shim arguments (win32)', () => {
  it('delivers hostile arguments byte for byte through all four start functions', {
    timeout: T,
  }, () => {
    const s = shim();
    const values = NAMES.map((n) => `${fwd(s.work)}/${n}/override.yml`);
    writeFileSync(join(s.dir, 'values.json'), JSON.stringify(values));
    const lib = (n: string) => `. '${q(join(repoRoot, 'launcher', 'lib', `${n}.ps1`))}'`;
    const body = [
      lib('session'),
      lib('bundle'),
      `$env:GELDAR_DOCKER = '${q(s.shim)}'`,
      `$env:REC_OUT = '${q(s.out)}'`,
      `$vals = Get-Content -LiteralPath '${q(join(s.dir, 'values.json'))}' -Raw | ConvertFrom-Json`,
      'foreach ($v in $vals) {',
      "  [void](Invoke-DockerChild @('-f', $v) @{} @() $true)",
      "  $h = Start-DockerProcess @('-f', $v); $h.P.WaitForExit(); $h.P.Dispose()",
      `  [void](Invoke-Bounded 60 '${q(s.shim)}' '-f' $v)`,
      `  [void](Start-CmdShim '${q(s.shim)}' @('-f', $v))`,
      '}',
    ].join('\n');
    const r = ps(body, s.work);
    expect(r.status, r.stderr).toBe(0);
    const got = readFileSync(s.out, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(got).toEqual(values.flatMap((v) => [0, 1, 2, 3].map(() => ['-f', v])));
    expect(existsSync(join(s.work, 'pwned.txt'))).toBe(false);
  });

  it('refuses a double quote with bad_state_path and starts nothing', { timeout: T }, () => {
    const s = shim();
    const body = `$env:REC_OUT = '${q(s.out)}'; Start-CmdShim '${q(s.shim)}' @('a' + [char]34 + 'b') | Out-Null`;
    const r = ps(body, s.work);
    expect(r.status).toBe(1);
    expect(existsSync(s.out)).toBe(false);
  });
});
