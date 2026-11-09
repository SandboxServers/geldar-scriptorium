import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Image tag the kit tests build and run; CI and local runs may override it.
export const KIT_IMAGE = process.env.KIT_IMAGE ?? 'geldar-kit:test';
// The one Squid pin; SC-41a and SC-41b import it from here, never from a test file.
export const SQUID_IMAGE =
  'ubuntu/squid@sha256:6a097f68bae708cedbabd6188d68c7e2e7a38cedd05a176e1cc0ba29e3bbe029';
// Absolute path of the repository root (tests/image/ is two levels down).
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let warned = false;
let built = false;

// Runs docker with the given arguments; a timeout (null status) reports 124.
export function run(
  args: string[],
  opts?: { input?: string; timeoutMs?: number },
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input: opts?.input,
    timeout: opts?.timeoutMs ?? 120000,
  });
  return {
    status: result.status ?? 124,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// True when the Docker daemon runs Linux containers; in CI a missing Docker is an error.
export function dockerReady(): boolean {
  const info = run(['info', '--format', '{{.OSType}}']);
  if (info.status === 0 && info.stdout.trim() === 'linux') return true;
  if (process.env.CI === 'true') {
    throw new Error(`Docker with Linux containers is required in CI: ${info.stderr.trim()}`);
  }
  if (!warned) {
    warned = true;
    console.warn('Docker with Linux containers is not available; image tests are skipped.');
  }
  return false;
}

// Set by global-setup.ts once it has built the image for this vitest run.
export const BUILT_FLAG = 'KIT_IMAGE_BUILT';

// Builds the kit image once per process; a no-op when global-setup.ts already built it
// for this run. Throws with stderr when the build fails.
export function buildKit(): void {
  if (built || process.env[BUILT_FLAG] === KIT_IMAGE) return;
  const result = spawnSync(
    'docker',
    ['build', '--target', 'kit', '-f', 'image/Dockerfile', '-t', KIT_IMAGE, '.'],
    { cwd: repoRoot, encoding: 'utf8', timeout: 900000 },
  );
  if (result.status !== 0) {
    throw new Error(`docker build failed (${result.status}): ${result.stderr ?? ''}`);
  }
  built = true;
}

// The path as docker wants it for -v; native Windows paths work as they are.
export function dockerPath(p: string): string {
  return p;
}
