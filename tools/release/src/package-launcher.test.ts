import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bashPath, runBash } from '../../../launcher/test/harness.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TOOL = join(ROOT, 'tools', 'release', 'src', 'package-launcher.ts');
const VERSION = 'kit-v1.2.3';
const PREFIX = 'geldar-play-1.2.3';
const ASSET = `${PREFIX}.tar.gz`;
const T = 60_000;

let scratch: string;
let n = 0;

function pack(out: string, version = VERSION, root?: string) {
  const args = [TOOL, '--version', version, '--out', out];
  if (root) args.push('--root', root);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function freshOut(): string {
  return join(scratch, `out${n++}`);
}

// A temp copy of the parts of the tree the tool reads.
function copyTree(): string {
  const root = join(scratch, `tree${n++}`);
  for (const p of ['launcher', 'image/compose', 'image/proxy', 'LICENSE']) {
    cpSync(join(ROOT, p), join(root, p), { recursive: true });
  }
  return root;
}

function extract(out: string): string {
  const dir = join(scratch, `x${n++}`);
  mkdirSync(dir);
  const r = spawnSync('tar', ['-xzf', ASSET, '-C', dir], { cwd: out });
  expect(r.status).toBe(0);
  return join(dir, PREFIX);
}

function listing(out: string): string[] {
  const r = spawnSync('tar', ['-tzf', ASSET], { cwd: out, encoding: 'utf8' });
  expect(r.status).toBe(0);
  return r.stdout.split(/\r?\n/).filter(Boolean);
}

function files(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...files(dir, r));
    else out.push(r);
  }
  return out;
}

let built: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'sc63e-'));
  built = freshOut();
  const r = pack(built);
  if (r.status !== 0) throw new Error(r.stderr);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('package-launcher', () => {
  it('two builds are byte-identical', { timeout: T }, () => {
    const other = freshOut();
    expect(pack(other).status).toBe(0);
    const sha = (d: string) =>
      createHash('sha256')
        .update(readFileSync(join(d, ASSET)))
        .digest('hex');
    expect(sha(other)).toBe(sha(built));
  });

  it('the listing is exactly the expected set, sorted, with no test files', { timeout: T }, () => {
    const got = listing(built);
    const launcher = (d: string) =>
      files(join(ROOT, 'launcher', d)).map((f) => `${PREFIX}/${d}/${f}`);
    const expected = [
      `${PREFIX}/geldar-play`,
      `${PREFIX}/geldar-play.ps1`,
      `${PREFIX}/LICENSE`,
      `${PREFIX}/VERSION`,
      ...launcher('lib'),
      ...launcher('messages.d'),
      ...launcher('config'),
      `${PREFIX}/share/compose/session.yml`,
      `${PREFIX}/share/proxy/squid.conf`,
      `${PREFIX}/share/proxy/allowlist-vendor.txt`,
      `${PREFIX}/share/proxy/world-ports-default.txt`,
      `${PREFIX}/share/troubleshooting.md`,
    ].sort();
    expect(got).toEqual(expected);
    expect(got.some((p) => p.includes('/test/') || p.endsWith('session.test.yml'))).toBe(false);
    expect(got.some((p) => p.endsWith('README.md'))).toBe(false);
  });

  it('modes are 0755 for geldar-play and 0644 for the rest', { timeout: T }, () => {
    const tar = gunzipSync(readFileSync(join(built, ASSET)));
    const modes = new Map<string, string>();
    for (let off = 0; off + 512 <= tar.length && tar[off] !== 0; ) {
      const name = tar
        .subarray(off, off + 100)
        .toString('latin1')
        .replace(/\0.*$/, '');
      const sz = Number.parseInt(tar.subarray(off + 124, off + 135).toString('latin1'), 8);
      modes.set(name, tar.subarray(off + 100, off + 107).toString('latin1'));
      off += 512 + Math.ceil(sz / 512) * 512;
    }
    expect(modes.get(`${PREFIX}/geldar-play`)).toBe('0000755');
    for (const [name, mode] of modes) {
      if (name !== `${PREFIX}/geldar-play`) expect(mode, name).toBe('0000644');
    }
  });

  it('extracts with LF-only text, VERSION and SHA256SUMS that verify', { timeout: T }, () => {
    const dir = extract(built);
    for (const f of files(dir)) {
      expect(readFileSync(join(dir, f)).includes(13), f).toBe(false);
    }
    expect(readFileSync(join(dir, 'VERSION'), 'utf8')).toBe('1.2.3\n');
    const sums = readFileSync(join(built, 'SHA256SUMS'), 'utf8');
    const hex = createHash('sha256')
      .update(readFileSync(join(built, ASSET)))
      .digest('hex');
    expect(sums).toBe(`${hex}  ${ASSET}\n`);
    if (process.platform !== 'win32') {
      expect(spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: built }).status).toBe(0);
    }
  });

  it('the extracted launcher finds its share directory', { timeout: T }, () => {
    const dir = extract(built);
    expect(statSync(join(dir, 'share', 'compose', 'session.yml')).isFile()).toBe(true);
    const d = bashPath(dir);
    const usage = runBash(`bash '${d}/geldar-play'`);
    expect(usage.status).toBe(2);
    expect(usage.stderr + usage.stdout).not.toBe('');
    const r = runBash(`GP_DIR='${d}'; . '${d}/lib/common.sh'; . '${d}/lib/session.sh'; share_dir`);
    expect(r.stdout).toBe(`${d}/share`);
  });

  it('refuses a symlink in launcher/lib', { timeout: T }, () => {
    const root = copyTree();
    try {
      symlinkSync(join(root, 'LICENSE'), join(root, 'launcher', 'lib', 'evil.sh'));
    } catch {
      return; // no symlink right on this machine; the refusal is exercised where it exists
    }
    const r = pack(freshOut(), VERSION, root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('symlink');
  });

  it('refuses a 6 MiB file', { timeout: T }, () => {
    const root = copyTree();
    writeFileSync(join(root, 'launcher', 'lib', 'big.sh'), 'a'.repeat(6 * 1024 * 1024));
    const r = pack(freshOut(), VERSION, root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('5 MiB');
  });

  it('refuses a CR byte in a text file', { timeout: T }, () => {
    const root = copyTree();
    writeFileSync(join(root, 'launcher', 'lib', 'cr.sh'), 'echo hi\r\n');
    const r = pack(freshOut(), VERSION, root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CR');
  });

  it('refuses a bad version', { timeout: T }, () => {
    for (const v of ['kit-v1.2.3 x', 'v1.2.3', 'kit-v1.2', 'kit-v1.2.3/../x']) {
      const out = freshOut();
      const r = pack(out, v);
      expect(r.status, v).toBe(1);
      expect(r.stderr).toContain('bad version');
    }
  });
});
