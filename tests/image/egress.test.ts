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
const fixture = resolve(repoRoot, 'tests/image/fixtures/allowlist-world.txt');
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
function composeUp(name: string, allowlist: string): string {
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

  beforeAll(() => {
    buildKit();
    const nt = run(
      ['build', '--target', 'nettest', '-f', 'image/Dockerfile', '-t', NETTEST_IMAGE, '.'],
      { timeoutMs: 600000 },
    );
    if (nt.status !== 0) throw new Error(`nettest build failed: ${nt.stderr}`);
  }, 900_000);

  beforeAll(() => {
    main = composeUp('main', allowlistFile(readFileSync(fixture, 'utf8')));
    empty = composeUp('empty', allowlistFile(''));
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
