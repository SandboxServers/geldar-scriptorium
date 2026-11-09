import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forGroup, type Launcher, type RunResult, repoRoot, run, type World } from '../harness.ts';
import { timingIt } from '../timing.ts';
import { attack, benign } from './world.ts';

// SC-60e: H-10 (T-10), the size gate. The seam case sources the launcher's own libraries and sets
// GP_BUNDLE_CAP; the real 52428800-byte boundary is one timing case. The boundary of
// MAX_BUNDLE_BYTES inside packages/verify has its own test (verify.test.ts:68-80), not repeated
// here. The 60 MB end-to-end hold is bundle.test.ts case 3 (finish.sh:127 and finish.ps1:142 turn
// bundle_too_large into a hold).

const T = 180_000;
const lib = join(repoRoot, 'launcher').replace(/\\/g, '/');

const bashSeam = `GP_DIR='${lib}'; export GP_DIR; GP_GROUPS=
for f in "$GP_DIR"/lib/*.sh; do . "$f"; done
read_player abc
sz() { wc -c < "$(player_dir abc)/session/bundle.bundle" | tr -d ' '; }
make_bundle abc; n=$(sz); echo "n=$n"
GP_BUNDLE_CAP=$n; GP_FAIL=; make_bundle abc; echo "at rc=$? fail=$GP_FAIL"
GP_BUNDLE_CAP=$((n - 1)); GP_FAIL=; make_bundle abc; echo "under rc=$? fail=$GP_FAIL"`;

const pwshSeam = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$GP_DIR = '${lib}'
. (Join-Path $GP_DIR 'lib/common.ps1')
foreach ($f in (Get-ChildItem -LiteralPath (Join-Path $GP_DIR 'lib') -Filter '*.ps1' | Where-Object { $_.Name -ne 'common.ps1' } | Sort-Object Name)) { . $f.FullName }
Import-Messages
Read-Player 'abc'
$bf = Join-Path (Join-Path (Get-PlayerDir 'abc') 'session') 'bundle.bundle'
[void](New-Bundle 'abc'); $n = (Get-Item -LiteralPath $bf).Length; [Console]::Out.Write("n=$n\`n")
$script:GP_BUNDLE_CAP = $n; $script:GP_FAIL = ''; $ok = New-Bundle 'abc'
[Console]::Out.Write("at rc=$([int](-not $ok)) fail=$($script:GP_FAIL)\`n")
$script:GP_BUNDLE_CAP = $n - 1; $script:GP_FAIL = ''; $ok = New-Bundle 'abc'
[Console]::Out.Write("under rc=$([int](-not $ok)) fail=$($script:GP_FAIL)\`n")`;

// Runs make_bundle / New-Bundle three times against the workspace the attack left: at the real
// cap (to learn the bundle size N), at exactly N, and at N - 1.
function seam(l: Launcher, w: World): { at: string; under: string } {
  const launcher: Launcher =
    l.name === 'bash'
      ? { ...l, prefix: ['-c'], entry: bashSeam }
      : { name: 'pwsh', command: 'pwsh', prefix: ['-NoProfile', '-Command'], entry: pwshSeam };
  const r: RunResult = run(launcher, [], {
    env: l.name === 'bash' ? w.env : w.envPwsh,
    timeoutMs: 120_000,
  });
  const line = (k: string) => r.stdout.split('\n').find((x) => x.startsWith(`${k} `)) ?? '';
  const n = Number(/^n=(\d+)/m.exec(r.stdout)?.[1] ?? Number.NaN);
  expect(n, `${r.stdout} ${r.stderr}`).toBeGreaterThan(0);
  return { at: line('at').trim(), under: line('under').trim() };
}

describe.each(forGroup('hostile'))('H-10 size ($name)', (launcher) => {
  it('seam: a bundle of exactly the cap passes, cap minus one is bundle_too_large', {
    timeout: T,
  }, () => {
    const a = attack(launcher, { until: 'verify', session: benign });
    expect(a.finish.status, a.finish.stderr).toBe(0);
    const s = seam(launcher, a.world);
    expect(s.at).toBe('at rc=0 fail=');
    expect(s.under).toBe('under rc=1 fail=bundle_too_large');
  });

  timingIt(
    'the real cap: a 48 MiB incompressible bundle of 48 one-MiB blobs (under 52428800) is not too large',
    () => {
      const a = attack(launcher, {
        until: 'verify',
        session: `mkdir -p memory
for i in $(seq 1 48); do head -c 1048576 /dev/urandom > memory/big$i.md; done
git add memory
git commit -q -m big
`,
      });
      expect(a.finish.status, a.finish.stderr).toBe(0);
      expect(a.finish.stderr).not.toContain('far too much');
    },
    T,
  );

  // H-10: a 200 MiB blob of zeros compresses to a small bundle; the gate's per-blob cap
  // (MAX_BLOB_BYTES in packages/verify) holds it with reason bundle_too_large.
  it('a 200 MiB zero blob under memory/ is held', { timeout: T }, () => {
    const a = attack(launcher, {
      until: 'verify',
      session: `mkdir -p memory
b=$(head -c 209715200 /dev/zero | git hash-object -w --stdin)
git update-index --add --cacheinfo 100644,$b,memory/zero.md
git commit -q -m zeros
`,
    });
    expect(a.finish.status, a.finish.stderr).toBe(3);
    expect(a.finish.stdout + a.finish.stderr).toContain('far too much');
  });
});
