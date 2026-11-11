// The in-test world as a container (SC-55b), and the generated compose file that adds it to the
// launcher's own session project. Test code only: nothing here ships.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../launcher/test/harness.ts';

// Docker and compose take forward slashes on every OS.
const fwd = (p: string): string => p.split('\\').join('/');

// SC-80: `play` needs the mock URL's host to equal mcp_base of the launcher's world.conf, so the
// e2e launcher runs with a copy of the image share whose world.conf names the stub world
// (http://world.test on port 80, hence an empty mcp_port). Returns the share directory (GELDAR_SHARE).
export function mockWorldShare(dir: string): string {
  const share = join(dir, 'share');
  mkdirSync(join(share, 'config'), { recursive: true });
  for (const d of ['compose', 'proxy', 'settings']) {
    cpSync(join(repoRoot, 'image', d), join(share, d), { recursive: true });
  }
  writeFileSync(join(share, 'config', 'world.conf'), 'mcp_base=http://world.test\nmcp_port=\n');
  return share;
}

// SC-55c: the mock world of the geldar repo (Wave 3). Our own image, pinned by digest; decision 27
// exempts it from the two-week age rule (never apply that to a third-party image).
export const MOCK_IMAGE =
  'ghcr.io/sandboxservers/geldar-mcp-mock@sha256:1bf80fac5354c50cc5c6c7f145b59490e337e20f72b0ac53c64fb0af51eedfb5';
export const mockMode = process.env.GELDAR_E2E_WORLD === 'mock';

// The mock listens on port 80 (the proxy allows only 80 and 443) with a short day. The token is
// only in the mounted file; the container gets no environment variable for it.
function mockWorld(tokensFile: string, scenario = 'scenarios/dawn.scenario.json'): string {
  return `  world:
    image: "${MOCK_IMAGE}"
    command: ["--tokens", "/run/secrets/mcp-tokens.json", "--scenario", "${scenario}", "--host", "0.0.0.0", "--port", "80", "--day-length-seconds", "24"]
    volumes:
      - type: bind
        source: "${fwd(tokensFile)}"
        target: /run/secrets/mcp-tokens.json
        read_only: true
        bind: { create_host_path: false }
    networks:
      outside:
        aliases: [world.test]
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
`;
}

function stubWorld(image: string): string {
  return `  world:
    image: "${image}"
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
`;
}

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
  tokensFile?: string; // mock mode: JSON of player id to token, mounted read only
  mockScenario?: string; // mock mode: --scenario, relative to the image's working directory
}): ExtraCompose {
  const proxyLogVolume = `geldar-e2e-${opts.id}-proxylog`;
  const world =
    opts.tokensFile === undefined
      ? stubWorld(opts.image)
      : mockWorld(opts.tokensFile, opts.mockScenario);
  const text = `services:
${world}  session:
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
