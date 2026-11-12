import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bashPath,
  type Launcher,
  makePlayer,
  makeWorld,
  repoRoot,
  run,
  type World,
} from './harness.ts';
import { expectRefusal } from './hostile/world.ts';

export interface DevWorldCase {
  value: string;
  player: string;
  ok: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
export const devWorldCases = JSON.parse(
  readFileSync(join(here, 'devworld-cases.json'), 'utf8'),
) as DevWorldCase[];

const share = bashPath(join(repoRoot, 'image'));
const text = (p: string) => readFileSync(p, 'utf8');
const messages = text(join(repoRoot, 'launcher', 'messages.d', '57-devworld.tsv'));

// The text of a message key, cut at its %s so the rest can be searched for in stderr.
function messagePieces(key: string): string[] {
  const line = messages.split('\n').find((l) => l.startsWith(`${key}\t`));
  if (!line) throw new Error(`${key} is missing from 57-devworld.tsv`);
  return line
    .slice(key.length + 1)
    .split('%s')
    .filter((s) => s.length > 0);
}

// What override.yml holds today with the seam unset, minus the per-player bind entries (their
// host paths vary) and with the player id filled in.
const storedOverride = (id: string, mcp: string) =>
  `services:
  session:
    volumes:
      - type: volume
        source: geldar_ws
        target: /player
      - type: volume
        source: geldar_cli
        target: /cli-home
    environment:
      GELDAR_MCP_URL: ${mcp}
      GELDAR_MCP_TOKEN:
      CLAUDE_CODE_OAUTH_TOKEN:
volumes:
  geldar_ws:
    external: true
    name: "geldar-ws-${id}"
  geldar_cli:
    external: true
    name: "geldar-cli-${id}-claude"
`;

const bindBlock =
  / {6}- type: bind\n {8}source: .*\n {8}target: .*\n {8}read_only: true\n {8}bind:\n {10}create_host_path: false\n/g;

function envFor(launcher: Launcher, w: World, extra: Record<string, string>) {
  const base = launcher.name === 'bash' ? w.env : w.envPwsh;
  return { ...base, GELDAR_SHARE: share, ...extra };
}

// The fake docker does not record its environment, so the session script dumps it, and the two
// allowlist files, to files the test reads back.
function probeScript(w: World): { env: Record<string, string>; read: () => Probe } {
  const f = join(w.root, 'devworld-probe.sh');
  const out = (n: string) => bashPath(join(w.root, n));
  writeFileSync(
    f,
    `env > "${out('env.txt')}"
cat "$GELDAR_WORLD_ALLOWLIST" > "${out('host.txt')}"
cat "\${GELDAR_WORLD_ALLOWLIST%.txt}-ports.txt" > "${out('ports.txt')}"
`,
  );
  return {
    env: { FAKE_SESSION: bashPath(f) },
    read: () => ({
      env: text(join(w.root, 'env.txt')),
      host: text(join(w.root, 'host.txt')),
      ports: text(join(w.root, 'ports.txt')),
    }),
  };
}

interface Probe {
  env: string;
  host: string;
  ports: string;
}

export function devWorldSuite(launcher: Launcher): void {
  describe(`dev world (${launcher.name})`, () => {
    for (const c of devWorldCases) {
      const label = JSON.stringify(c.value);
      it(`${c.ok ? 'starts' : 'refuses'} ${label}`, { timeout: 180_000 }, () => {
        const w = makeWorld();
        const p = makePlayer(w, { id: c.player });
        const value = c.value.replaceAll('<id>', c.player);
        const probe = probeScript(w);
        const env = envFor(launcher, w, { ...probe.env, GELDAR_DEV_MCP_URL: value });
        const pub = join(p.stateDir, 'pub');
        if (c.ok) {
          const prep = run(launcher, ['__prepare', p.id, 'play'], { env, timeoutMs: 120_000 });
          expect(prep.status, prep.stderr).toBe(0);
          const r = run(launcher, ['__session', p.id, 'play'], { env, timeoutMs: 120_000 });
          expect(r.status, r.stderr).toBe(0);
          const got = probe.read();
          // The container's GELDAR_MCP_URL is set by compose from override.yml, which the fake
          // docker does not read, so it is checked in the file and not in the env dump.
          const ov = text(join(p.stateDir, 'session', 'override.yml'));
          expect(ov).toContain(`      GELDAR_MCP_URL: "${value}"\n`);
          expect(ov).toContain('      - "host.docker.internal:host-gateway"\n');
          expect(got.env).not.toContain('GELDAR_DEV_MCP_URL');
          expect(got.host).toBe('host.docker.internal\n');
          expect(got.ports).toBe(`${/:(\d+)\//.exec(value)?.[1]}\n`);
          for (const piece of messagePieces('dev_world_active')) {
            expect(r.stderr).toContain(piece);
          }
          expect(r.stderr).toContain(value);
        } else {
          // play refuses the value before its lock, its state and any docker call, so the count
          // starts at play itself. Only the probes every verb makes (version, info, image inspect,
          // compose version) are not docker work.
          const r = run(launcher, ['play', p.id], { env, timeoutMs: 120_000 });
          expectRefusal(r, 'dev_world_bad', { status: 1 });
          const work = w
            .calls()
            .filter(
              (call) =>
                !(
                  call[0] === 'version' ||
                  call[0] === 'info' ||
                  (call[0] === 'image' && call[1] === 'inspect') ||
                  (call[0] === 'compose' && call[1] === 'version')
                ),
            );
          expect(work, 'a docker call was made').toEqual([]);
          expect(
            w.calls().filter((call) => call.join(' ').includes(`geldar-ws-${p.id}`)),
            'a workspace volume was touched',
          ).toEqual([]);
          expect(existsSync(join(p.stateDir, 'session', 'running'))).toBe(false);
          expect(existsSync(join(pub, 'allowlist-world.txt'))).toBe(false);
          expect(existsSync(join(pub, 'allowlist-world-ports.txt'))).toBe(false);
        }
      });
    }

    it('leaves override.yml as it is today when the variable is unset', {
      timeout: 180_000,
    }, () => {
      const w = makeWorld();
      const p = makePlayer(w, { id: 'alpha' });
      const probe = probeScript(w);
      const env = envFor(launcher, w, probe.env);
      const prep = run(launcher, ['__prepare', p.id, 'play'], { env, timeoutMs: 120_000 });
      expect(prep.status, prep.stderr).toBe(0);
      const r = run(launcher, ['__session', p.id, 'play'], { env, timeoutMs: 120_000 });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).not.toContain('dev_world');
      const o = text(join(p.stateDir, 'session', 'override.yml'));
      expect(o).not.toContain('extra_hosts');
      expect(o).not.toContain('host-gateway');
      const mcp = /GELDAR_MCP_URL: (.*)\n/.exec(o)?.[1] ?? '';
      expect(o.replace(bindBlock, '')).toBe(storedOverride(p.id, mcp));
    });
  });
}
