// The in-test world as a container (SC-55b), and the generated compose file that adds it to the
// launcher's own session project. Test code only: nothing here ships.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Docker and compose take forward slashes on every OS.
const fwd = (p: string): string => p.split('\\').join('/');

export interface ExtraCompose {
  file: string;
  proxyLogVolume: string;
}

// A compose file for GELDAR_EXTRA_COMPOSE (honored with GELDAR_INTERNAL=1). It adds:
//  - `world`: the stub variant image running the SDK server of SC-55a on port 80, on the project's
//    `outside` network with alias world.test, binding 0.0.0.0 here and nowhere else;
//  - `session.depends_on: [world]`, because `compose run session` starts only its dependencies;
//  - the scenario folder, read only, at /e2e-scen in the session;
//  - a named volume on the proxy's log folder, so the test can read access.log after `down`.
// The token reaches the world through the environment variable E2E_WORLD_TOKEN, never the file.
export function writeExtraCompose(opts: {
  dir: string;
  image: string;
  scenarioDir: string;
  id: string;
}): ExtraCompose {
  const proxyLogVolume = `geldar-e2e-${opts.id}-proxylog`;
  const text = `services:
  world:
    image: "${opts.image}"
    command: ["node", "/opt/geldar-stub/packages/stub-cli/src/test-world.ts"]
    environment:
      GELDAR_TEST_WORLD_HOST: "0.0.0.0"
      GELDAR_TEST_WORLD_PORT: "80"
      GELDAR_TEST_WORLD_TOKEN: \${E2E_WORLD_TOKEN:?}
    networks:
      outside:
        aliases: [world.test]
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
  session:
    depends_on: [world]
    volumes:
      - type: bind
        source: "${fwd(opts.scenarioDir)}"
        target: /e2e-scen
        read_only: true
  proxy:
    volumes:
      - type: volume
        source: proxylog
        target: /var/log/squid
volumes:
  proxylog:
    name: "${proxyLogVolume}"
`;
  const file = join(opts.dir, 'extra.yml');
  writeFileSync(file, text);
  return { file: fwd(file), proxyLogVolume };
}

export function docker(
  args: string[],
  timeoutMs = 120_000,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: timeoutMs });
  return { status: r.status ?? 124, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// Removes what one player id left behind, each by exact name or by its own compose project label.
export function cleanPlayer(id: string, extraVolumes: string[]): void {
  const project = `geldar-${id}`;
  const ids = docker([
    'ps',
    '-aq',
    '--filter',
    `label=com.docker.compose.project=${project}`,
  ]).stdout.split(/\s+/);
  for (const c of ids.filter(Boolean)) docker(['rm', '-f', c]);
  for (const n of ['inside', 'outside']) docker(['network', 'rm', `${project}_${n}`]);
  for (const v of [`geldar-ws-${id}`, `geldar-cli-${id}-claude`, ...extraVolumes]) {
    docker(['volume', 'rm', '-f', v]);
  }
}
