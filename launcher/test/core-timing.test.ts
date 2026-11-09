import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect } from 'vitest';
import { bashPath, forGroup, type Launcher, makeWorld, repoRoot, run, runBash } from './harness.ts';
import { timingIt } from './timing.ts';

function envOf(launcher: Launcher, world: ReturnType<typeof makeWorld>, extra = {}) {
  return { ...(launcher.name === 'bash' ? world.env : world.envPwsh), ...extra };
}

// Spawning is slow on Windows; the bound is 10 s elsewhere.
const win = process.platform === 'win32';
const slow = win ? 25_000 : 10_000;

describe.each(forGroup('core'))('core timing ($name)', (launcher) => {
  timingIt(
    '14. __bounded stops a hung command and its whole process group',
    () => {
      const w = makeWorld();
      const docker = launcher.name === 'bash' ? w.env.GELDAR_DOCKER : w.envPwsh.GELDAR_DOCKER;
      const t0 = Date.now();
      const a = run(
        launcher,
        [
          '__bounded',
          win ? '8' : '2',
          '--container',
          'geldar-t-1',
          docker as string,
          'run',
          '--rm',
          '--label',
          'geldar.role=workspace-init',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
          '--name',
          'geldar-t-1',
          'img',
          'sh',
          '-c',
          'true',
        ],
        { env: envOf(launcher, w, { FAKE_ROLE_SLEEP: '30' }), timeoutMs: 60_000 },
      );
      expect(Date.now() - t0).toBeLessThan(slow);
      expect(a.status).not.toBe(0);
      const verbs = w.calls().map((c) => c.slice(0, 3).join(' '));
      const k = verbs.indexOf('kill geldar-t-1');
      expect(k).toBeGreaterThan(0);
      expect(verbs.indexOf('rm -f geldar-t-1')).toBeGreaterThan(k);

      const pidFile = join(w.root, 'sleeper.pid');
      const t1 = Date.now();
      // pwsh: the grandchild is a native Windows process (ping), checked by its Windows PID, so
      // killing only the top process leaves it alive and the assertion fails.
      const nativeGrandchild = launcher.name === 'pwsh' && win;
      const b = run(
        launcher,
        nativeGrandchild
          ? [
              '__bounded',
              '4',
              'pwsh',
              '-NoProfile',
              '-Command',
              `$c = Start-Process ping -ArgumentList '-n','60','127.0.0.1' -PassThru -WindowStyle Hidden -RedirectStandardOutput '${pidFile.replace(/'/g, "''")}.out'; $c.Id | Set-Content -Path '${pidFile.replace(/'/g, "''")}'; Start-Sleep 60`,
            ]
          : [
              '__bounded',
              '2',
              'sh',
              '-c',
              `sleep 60 > /dev/null 2>&1 & echo $! > '${bashPath(pidFile)}'; wait`,
            ],
        { env: envOf(launcher, w), timeoutMs: 30_000 },
      );
      const pid = readFileSync(pidFile, 'utf8').trim();
      let alive: string;
      if (nativeGrandchild) {
        const g = spawnSync(
          'pwsh',
          [
            '-NoProfile',
            '-Command',
            `if (Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue) { 'alive' } else { 'dead' }`,
          ],
          { encoding: 'utf8' },
        );
        alive = g.stdout.trim();
        if (alive === 'alive') process.kill(Number(pid));
      } else {
        alive = runBash(`kill -0 ${pid} 2>/dev/null && echo alive || echo dead`).stdout.trim();
        if (alive === 'alive') runBash(`kill -9 ${pid}`);
      }
      expect(alive).toBe('dead');
      expect(Date.now() - t1).toBeLessThan(slow);
      expect(b.status).toBe(124);

      if (launcher.name === 'pwsh' && win) {
        // A .cmd under a path with spaces runs through cmd.exe and keeps its arguments.
        const spaced = join(w.root, 'dir with spaces');
        mkdirSync(spaced, { recursive: true });
        const cmdFile = join(spaced, 'echo arg.cmd');
        writeFileSync(cmdFile, '@echo off\r\necho got %1\r\nexit /b 4\r\n');
        const sp = run(launcher, ['__bounded', '10', cmdFile, 'hello'], {
          env: envOf(launcher, w),
        });
        expect(sp.stdout).toContain('got hello');
        expect(sp.status).toBe(4);
      }

      for (const bad of ['0x10', '$(touch pwned)', '-1', '', '1.5']) {
        const e = run(launcher, ['__bounded', bad, 'true'], { env: envOf(launcher, w) });
        expect(e.status).toBe(2);
        expect(e.stderr).toContain('Usage: geldar-play');
      }
      expect(existsSync(join(repoRoot, 'pwned'))).toBe(false);

      const c = run(launcher, ['__bounded', '5', 'sh', '-c', 'echo hi; exit 3'], {
        env: envOf(launcher, w),
      });
      expect(c.status).toBe(3);
      expect(c.stdout).toBe('hi\n');

      const d = run(launcher, ['__bounded', '5', 'true'], {
        env: envOf(launcher, w, { GELDAR_INTERNAL: '' }),
      });
      expect(d.status).toBe(2);
      expect(d.stderr).toContain('That is not a command.');
    },
    60_000,
  );
});
