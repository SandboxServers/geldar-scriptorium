import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bashPath, forGroup, makePlayer, makeWorld, run, runLib } from '../harness.ts';
import { expectNoDockerCall, expectRefusal } from './world.ts';

// N8: the test seams. Every GELDAR_ name in the launcher is classified in seams.json; gated names
// are read only through gp_env / Get-GatedEnv; with GELDAR_INTERNAL unset they change nothing.

const here = dirname(fileURLToPath(import.meta.url));
const launcherDir = join(here, '..', '..');
const lists = JSON.parse(readFileSync(join(here, 'seams.json'), 'utf8')) as Record<
  'gate' | 'gated' | 'human_seams' | 'container_vars',
  string[]
>;
const T = 60_000;

function sources(): { file: string; lines: string[] }[] {
  const lib = join(launcherDir, 'lib');
  const files = readdirSync(lib)
    .filter((f) => f.endsWith('.sh') || f.endsWith('.ps1'))
    .map((f) => join(lib, f));
  for (const f of readdirSync(launcherDir))
    if (f.startsWith('geldar-play') && existsSync(join(launcherDir, f)))
      files.push(join(launcherDir, f));
  return files.map((file) => ({ file, lines: readFileSync(file, 'utf8').split('\n') }));
}

const all = [...lists.gate, ...lists.gated, ...lists.human_seams, ...lists.container_vars];
const isListed = (name: string) =>
  all.some((e) => (lists.gated.includes(e) && e.endsWith('_') ? name.startsWith(e) : e === name));

describe('N8 seam lists', () => {
  it('(4) each list is sorted and unique, and no name is in two lists', () => {
    for (const [k, v] of Object.entries(lists)) {
      expect(v, k).toEqual([...new Set(v)].sort());
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it('(1) every GELDAR_ name in the launcher is classified', () => {
    const unknown: string[] = [];
    for (const { file, lines } of sources())
      for (const [i, l] of lines.entries())
        for (const m of l.match(/GELDAR_[A-Z0-9_]+/g) ?? [])
          if (!isListed(m)) unknown.push(`${file}:${i + 1} ${m}`);
    expect(unknown).toEqual([]);
  });

  it('(2) a gated name is read only through gp_env / Get-GatedEnv', () => {
    const bad: string[] = [];
    const gated = lists.gated.filter((n) => !n.endsWith('_'));
    for (const { file, lines } of sources()) {
      const ps = file.endsWith('.ps1') || /geldar-play.*\.ps1$/.test(file);
      for (const [i, l] of lines.entries()) {
        if (/^\s*#/.test(l)) continue;
        for (const n of gated) {
          if (!l.includes(n)) continue;
          const through = ps ? /Get-GatedEnv\s+'/.test(l) : /gp_env\s/.test(l);
          const bare = new RegExp(
            [`[$]\\{?${n}\\b`, `[$]env:${n}\\b`, `GetEnvironmentVariable\\('${n}'`].join('|'),
          );
          if (bare.test(l) || !through) bad.push(`${file}:${i + 1} ${n}: ${l.trim()}`);
        }
      }
    }
    // GELDAR_STUB_ (a prefix) is read in session.* only under an explicit GELDAR_INTERNAL=1 test.
    expect(bad).toEqual([]);
  });
});

describe.each(forGroup('hostile'))(
  'N8 gated variables with the gate closed ($name)',
  (launcher) => {
    const envOf = (w: ReturnType<typeof makeWorld>, extra: Record<string, string>) => ({
      ...(launcher.name === 'bash' ? w.env : w.envPwsh),
      ...extra,
    });

    it('(3) EXTRA_COMPOSE adds no file and STUB_X is absent from the override', {
      timeout: T,
    }, () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'abc' });
      const extra = bashPath(join(w.root, 'extra.yml'));
      writeFileSync(join(w.root, 'extra.yml'), 'services: {}\n');
      const base = envOf(w, {});
      const a = run(launcher, ['__prepare', 'abc', 'play'], { env: base, timeoutMs: T });
      expect(a.status, a.stderr).toBe(0);
      const hostile = envOf(w, {
        GELDAR_INTERNAL: '',
        GELDAR_EXTRA_COMPOSE: extra,
        GELDAR_STUB_X: '1',
      });
      const libs = ['player', 'session'];
      const dot = (n: string) => `. '${bashPath(join(launcherDir, 'lib', `${n}.sh`))}'`;
      const dotPs = (n: string) => `. (Join-Path $GP_DIR 'lib/${n}.ps1')`;
      const r = runLib(
        launcher,
        {
          bash: `${libs.map(dot).join('; ')}; GP_GROUPS=; start_session abc play`,
          pwsh: `${libs.map(dotPs).join('; ')}; Start-PlayerSession abc play`,
        },
        { env: hostile, timeoutMs: T },
      );
      expect(r.status, r.stderr).toBe(0);
      const o = readFileSync(join(p.stateDir, 'session', 'override.yml'), 'utf8');
      expect(o).not.toContain('GELDAR_STUB_X');
      expect(JSON.stringify(w.calls())).not.toContain('extra.yml');
    });

    it('(3) UNSAFE_IMAGE plus a tag is image_refused', { timeout: T }, () => {
      const w = makeWorld();
      makePlayer(w, { id: 'abc' });
      const env = envOf(w, {
        GELDAR_INTERNAL: '',
        GELDAR_KIT_IMAGE: 'registry.test/geldar-kit:dev',
        GELDAR_UNSAFE_IMAGE: '1',
      });
      const r = run(launcher, ['play', 'abc'], { env, timeoutMs: T });
      expectRefusal(r, 'image_refused', { status: 1 });
      expectNoDockerCall(w);
    });

    it('(3) HELPER_TIMEOUT_SEC does not change the bound (0 would be a usage error)', {
      timeout: T,
    }, () => {
      const w = makeWorld();
      const r = runLib(
        launcher,
        { bash: 'run_bounded 5 true', pwsh: 'Invoke-Bounded 5 pwsh -NoProfile -Command exit' },
        { env: envOf(w, { GELDAR_INTERNAL: '', GELDAR_HELPER_TIMEOUT_SEC: '0' }), timeoutMs: T },
      );
      expect(r.status, r.stderr).toBe(0);
    });
  },
);
