// corpus: MB-02
// corpus: MB-08
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildKit, dockerReady, KIT_IMAGE, repoRoot, run, SQUID_IMAGE } from './docker.ts';

const ready = dockerReady();
const composeDir = resolve(repoRoot, 'image/compose');
const sessionYml = resolve(composeDir, 'session.yml');
const overlayYml = resolve(composeDir, 'session.test.yml');
const fixtureDir = resolve(repoRoot, 'tests/image/fixtures');
const fixture = resolve(fixtureDir, 'allowlist-world.txt');
const NETTEST_IMAGE = 'geldar-kit-nettest:test';
const uid = process.getuid?.() ?? 1000;
const gid = process.getgid?.() ?? 1000;

const temps: string[] = [];
const projects: string[] = [];
const composeEnvs = new Map<string, NodeJS.ProcessEnv>();

// A directory the proxy and the session can read (0755 on Linux runners).
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-egress-'));
  chmodSync(dir, 0o755);
  temps.push(dir);
  return dir;
}

// Writes an allowlist file readable by Squid under cap_drop ALL (0644 in a 0755 directory).
function allowlistFile(content: string): string {
  const file = join(tempDir(), 'allowlist-world.txt');
  writeFileSync(file, content);
  chmodSync(file, 0o644);
  return file;
}

// Copies a fixture to a file Squid can read, or returns undefined for the compose default.
function portsFile(name: string | undefined, content?: string): string | undefined {
  if (name === undefined) return undefined;
  const file = join(tempDir(), 'allowlist-world-ports.txt');
  writeFileSync(file, content ?? readFileSync(resolve(fixtureDir, name), 'utf8'));
  chmodSync(file, 0o644);
  return file;
}

// Runs docker compose for one project with both compose files.
function compose(project: string, args: string[], timeoutMs: number) {
  const r = spawnSync(
    'docker',
    ['compose', '-p', project, '-f', sessionYml, '-f', overlayYml, ...args],
    { encoding: 'utf8', env: composeEnvs.get(project), timeout: timeoutMs },
  );
  return { status: r.status ?? 124, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// Brings up one compose project with the given world allowlist; returns its name.
function composeUp(name: string, allowlist: string, ports?: string): string {
  const project = `geldar-egress-${name}-${process.pid}`;
  projects.push(project);
  composeEnvs.set(project, {
    ...process.env,
    KIT_IMAGE,
    NETTEST_IMAGE,
    GELDAR_UID: String(uid),
    GELDAR_GID: String(gid),
    GELDAR_WORKSPACE: tempDir(),
    GELDAR_CLI_HOME: tempDir(),
    GELDAR_WORLD_ALLOWLIST: allowlist,
  });
  const env = composeEnvs.get(project) as NodeJS.ProcessEnv;
  if (ports === undefined) delete env.GELDAR_WORLD_PORTS;
  else env.GELDAR_WORLD_PORTS = ports;
  const up = compose(project, ['up', '-d', '--wait'], 280000);
  if (up.status !== 0) throw new Error(`compose up failed: ${up.stderr}`);
  return project;
}

// Runs a shell command inside the session container of a project.
function inSession(project: string, cmd: string) {
  return compose(project, ['exec', '-T', 'session', 'sh', '-c', cmd], 60000);
}

const STATUS = "curl -sS -m 10 -o /dev/null -w '%{http_code}'";

describe.skipIf(!ready)('egress through the allowlist proxy', () => {
  let main = '';
  let empty = '';
  let port18443 = '';
  let defaults = '';
  let dev = '';

  beforeAll(() => {
    buildKit();
    const nt = run(
      ['build', '--target', 'nettest', '-f', 'image/Dockerfile', '-t', NETTEST_IMAGE, '.'],
      { timeoutMs: 600000 },
    );
    if (nt.status !== 0) throw new Error(`nettest build failed: ${nt.stderr}`);
  }, 900_000);

  beforeAll(() => {
    const world = readFileSync(fixture, 'utf8');
    main = composeUp('main', allowlistFile(world), portsFile('allowlist-world-ports-80.txt'));
    empty = composeUp('empty', allowlistFile(''));
    port18443 = composeUp('p18443', allowlistFile(world), portsFile('allowlist-world-ports.txt'));
    defaults = composeUp('default', allowlistFile(world));
    dev = composeUp(
      'dev',
      allowlistFile(readFileSync(resolve(fixtureDir, 'allowlist-dev-world.txt'), 'utf8')),
      portsFile('inline', '8787\n'),
    );
    // The overlay's fake world listens on 80 only; give the 18443 project a listener on 18443.
    const listener = compose(
      port18443,
      [
        'exec',
        '-d',
        '-T',
        'world',
        'node',
        '-e',
        "require('http').createServer((q,r)=>r.end('world ok')).listen(18443)",
      ],
      60000,
    );
    if (listener.status !== 0) throw new Error(`listener failed: ${listener.stderr}`);
  }, 300_000);

  afterAll(() => {
    for (const p of projects) compose(p, ['down', '-v', '--remove-orphans'], 100000);
    for (const t of temps) rmSync(t, { recursive: true, force: true });
  }, 120_000);

  it('allows the world host through the proxy', () => {
    const r = inSession(main, 'curl -sS -m 10 http://world.test/');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('world ok');
  }, 120_000);

  it('refuses github.com through the proxy', () => {
    expect(inSession(main, `${STATUS} http://github.com/`).stdout.trim()).toBe('403');
    const https = inSession(main, 'curl -sS -m 10 https://github.com/');
    expect(https.status).not.toBe(0);
    expect(https.stderr).toContain('CONNECT tunnel failed, response 403');
  }, 120_000);

  it('refuses a raw IP', () => {
    const id = compose(main, ['ps', '-q', 'world'], 30000).stdout.trim();
    const insp = run([
      'inspect',
      '-f',
      '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}',
      id,
    ]);
    const addr = insp.stdout.trim().split(/\s+/)[0];
    expect(addr).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(inSession(main, `${STATUS} http://${addr}/`).stdout.trim()).toBe('403');
  }, 120_000);

  it('cannot go direct without the proxy variables', () => {
    const unset = 'env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY';
    const a = inSession(main, `${unset} curl --noproxy '*' -sS -m 6 http://world.test/`);
    expect(a.status).not.toBe(0);
    const b = inSession(main, `${unset} curl --noproxy '*' -sS -m 6 https://example.com/`);
    expect(b.status).not.toBe(0);
  }, 120_000);

  it('cannot resolve github.com', () => {
    const r = inSession(main, 'nslookup github.com');
    expect(r.status).not.toBe(0);
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/SERVFAIL|can't find/);
    // No answer block: an "Address:" line may only appear in the server block (first paragraph).
    expect(out.split('\n\n').slice(1).join('\n')).not.toMatch(/^Address:/m);
  }, 120_000);

  it('cannot resolve world.test either', () => {
    const r = inSession(main, 'nslookup world.test');
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/SERVFAIL|can't find/);
  }, 120_000);

  it('refuses a non-standard port on an allowed host', () => {
    expect(inSession(main, `${STATUS} http://world.test:8080/`).stdout.trim()).toBe('403');
  }, 120_000);

  it('allows the world host on the owner-set port only', () => {
    const ok = inSession(port18443, 'curl -sS -m 10 http://world.test:18443/');
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim()).toBe('world ok');
    expect(inSession(port18443, 'curl -sS -m 10 -p http://world.test:18443/').stdout.trim()).toBe(
      'world ok',
    );
    // The ports file holds one port only: 443 and 80 on the same host are refused.
    expect(inSession(port18443, `${STATUS} http://world.test:443/`).stdout.trim()).toBe('403');
    expect(inSession(port18443, `${STATUS} http://world.test:80/`).stdout.trim()).toBe('403');
    expect(inSession(port18443, `${STATUS} http://world.test:8080/`).stdout.trim()).toBe('403');
  }, 120_000);

  it('does not open the owner-set port on a vendor host or with the default ports file', () => {
    const vendorHost = readFileSync(resolve(repoRoot, 'image/proxy/allowlist-vendor.txt'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '' && !l.startsWith('#'));
    expect(vendorHost).toBeTruthy();
    expect(inSession(port18443, `${STATUS} http://${vendorHost}:18443/`).stdout.trim()).toBe('403');
    expect(inSession(defaults, `${STATUS} http://world.test:18443/`).stdout.trim()).toBe('403');
  }, 120_000);

  it('refuses a CONNECT to the world host on port 80 even when 80 is the world port', () => {
    const r = inSession(main, 'curl -sS -m 10 -p http://world.test:80/');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('CONNECT tunnel failed, response 403');
  }, 120_000);

  it('refuses ports 443 and 80 on a host that has only another world port', () => {
    expect(inSession(dev, `${STATUS} http://host.docker.internal:443/`).stdout.trim()).toBe('403');
    expect(inSession(dev, `${STATUS} http://host.docker.internal:80/`).stdout.trim()).toBe('403');
  }, 120_000);

  it('an empty allowlist changes the answer to 403', () => {
    expect(inSession(empty, `${STATUS} http://world.test/`).stdout.trim()).toBe('403');
  }, 120_000);

  it('runs the session unprivileged', () => {
    expect(inSession(main, 'id -u').stdout.trim()).toBe(String(uid));
    const status = inSession(main, 'cat /proc/self/status').stdout;
    expect(status).toMatch(/^CapBnd:\s+0000000000000000\s*$/m);
    expect(status).toMatch(/^CapEff:\s+0000000000000000\s*$/m);
  }, 120_000);

  it('session.yml uses the pinned Squid', () => {
    expect(readFileSync(sessionYml, 'utf8')).toContain(SQUID_IMAGE);
  }, 120_000);
});
