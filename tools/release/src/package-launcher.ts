// Packages the launcher as one reproducible geldar-play-<version>.tar.gz plus SHA256SUMS.
// The signature is made by the workflow; this tool only writes the files it signs.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type TarEntry, tarGz } from './tar.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VERSION_RE = /^kit-v((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.]+)?)$/;
const MAX_ENTRIES = 200;
const MAX_TOTAL = 5 * 1024 * 1024;

class Fail extends Error {}

interface Source {
  from: string; // path relative to the root
  to: string; // path inside the package directory
}

function checkRel(rel: string): void {
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || rel.split(/[\\/]/).includes('..')) {
    throw new Fail(`refusing path: ${rel}`);
  }
}

// Every file under a directory, sorted, refusing anything that is not a plain file or directory.
function walk(root: string, rel: string, out: Source[]): void {
  for (const name of readdirSync(join(root, rel)).sort()) {
    const child = `${rel}/${name}`;
    if (name === 'README.md') continue;
    const st = lstatSync(join(root, child));
    if (st.isSymbolicLink()) throw new Fail(`refusing a symlink: ${child}`);
    if (st.isDirectory()) walk(root, child, out);
    else if (st.isFile()) out.push({ from: child, to: child.replace(/^launcher\//, '') });
    else throw new Fail(`refusing a special file: ${child}`);
  }
}

function collect(root: string): Source[] {
  const out: Source[] = [
    { from: 'launcher/geldar-play', to: 'geldar-play' },
    { from: 'launcher/geldar-play.ps1', to: 'geldar-play.ps1' },
  ];
  for (const d of ['lib', 'messages.d', 'config']) walk(root, `launcher/${d}`, out);
  out.push(
    { from: 'image/compose/session.yml', to: 'share/compose/session.yml' },
    { from: 'image/proxy/squid.conf', to: 'share/proxy/squid.conf' },
    { from: 'image/proxy/allowlist-vendor.txt', to: 'share/proxy/allowlist-vendor.txt' },
    { from: 'image/proxy/world-ports-default.txt', to: 'share/proxy/world-ports-default.txt' },
    { from: 'LICENSE', to: 'LICENSE' },
  );
  return out;
}

function readPlain(root: string, rel: string): Buffer {
  checkRel(rel);
  const path = join(root, rel);
  const st = lstatSync(path);
  if (st.isSymbolicLink()) throw new Fail(`refusing a symlink: ${rel}`);
  if (!st.isFile()) throw new Fail(`not a file: ${rel}`);
  if (st.size > MAX_TOTAL) throw new Fail(`file over 5 MiB: ${rel}`);
  const data = readFileSync(path);
  if (data.includes(13)) throw new Fail(`CR byte (LF only): ${rel}`);
  return data;
}

export function build(root: string, version: string): { name: string; bytes: Buffer } {
  const m = VERSION_RE.exec(version);
  if (!m?.[1]) throw new Fail(`bad version (want kit-vX.Y.Z): ${version}`);
  const text = m[1];
  const prefix = `geldar-play-${text}`;
  const entries: TarEntry[] = [];
  let total = 0;
  for (const s of collect(root)) {
    checkRel(s.to);
    const data = readPlain(root, s.from);
    total += data.length;
    const exec = s.to === 'geldar-play';
    entries.push({ path: `${prefix}/${s.to}`, data, mode: exec ? 0o755 : 0o644 });
  }
  entries.push({ path: `${prefix}/VERSION`, data: Buffer.from(`${text}\n`), mode: 0o644 });
  if (entries.length > MAX_ENTRIES) throw new Fail(`more than ${MAX_ENTRIES} entries`);
  if (total > MAX_TOTAL) throw new Fail('total over 5 MiB');
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { name: `${prefix}.tar.gz`, bytes: tarGz(entries) };
}

function main(argv: string[]): void {
  const opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k || !['--version', '--out', '--root'].includes(k) || v === undefined) {
      throw new Fail('usage: package-launcher.ts --version kit-vX.Y.Z --out <dir> [--root <dir>]');
    }
    opt[k] = v;
  }
  if (!opt['--version'] || !opt['--out']) throw new Fail('--version and --out are required');
  const { name, bytes } = build(resolve(opt['--root'] ?? REPO_ROOT), opt['--version']);
  const out = resolve(opt['--out']);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, name), bytes);
  const sum = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(out, 'SHA256SUMS'), `${sum}  ${name}\n`);
  console.log(`wrote ${name} (${sum})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    console.error(`package-launcher: ${e.message}`);
    process.exit(1);
  }
}
