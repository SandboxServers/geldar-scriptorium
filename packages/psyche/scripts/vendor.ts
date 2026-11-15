// Vendors the released psyche engine into packages/psyche/engine and records its hash in MIRROR.json.
// Run from the repository root:
//   node packages/psyche/scripts/vendor.ts --source <dir> --commit <40 lower-case hex>
// <dir> is the released psyche/src directory of the geldar repo; RELEASE.json sits next to it.
// engine/ is written only by this script: a change to the engine means a new geldar release, a new
// commit and a new hash in the same PR.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The tag of the release this mirror is pinned to. */
export const RELEASE_TAG = 'psyche-v1.0.0';
/** The largest file the vendor copies. */
export const MAX_FILE_BYTES = 200 * 1024;

const SOURCE_REPO = 'SandboxServers/geldar';
const SOURCE_PATH = 'psyche/src';
const TREE_ALGORITHM = 'geldar-tree-v1';

export interface SourceFile {
  /** POSIX path relative to the directory. */
  path: string;
  /** Absolute path on disk. */
  full: string;
}

export interface ReleaseFile {
  format: number;
  tag: string;
  tree_hash_algorithm: string;
  tree_hash: string;
  files: Array<{ path: string; sha256: string }>;
}

export interface VendorOptions {
  source: string;
  commit: string;
  /** The package root: engine/ and MIRROR.json are written here. */
  packageRoot: string;
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The regular files under root, sorted by the UTF-8 bytes of their path. A symlink is refused. */
export function walkFiles(root: string): SourceFile[] {
  const found: SourceFile[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = relative(root, full).split(sep).join('/');
      const info = lstatSync(full);
      if (info.isSymbolicLink()) throw new Error(`refusing a symbolic link: ${rel}`);
      if (info.isDirectory()) visit(full);
      else if (info.isFile()) found.push({ path: rel, full });
      else throw new Error(`refusing a non-regular entry: ${rel}`);
    }
  };
  visit(root);
  return found.sort((a, b) => byteOrder(a.path, b.path));
}

/**
 * The card's tree hash of an engine directory: SHA-256 over one `<path>\0<sha256 hex>\n` line per
 * file, the files sorted by POSIX path in plain byte order. Bytes are hashed as they are.
 */
export function treeHash(dir: string): string {
  const lines = walkFiles(dir).map(
    ({ path, full }) => `${path}\0${sha256Hex(readFileSync(full))}\n`,
  );
  return createHash('sha256').update(lines.join(''), 'utf8').digest('hex');
}

/** The content with each CRLF turned into LF. Bytes pass through latin1, so none is changed. */
function lfBytes(bytes: Buffer): Buffer {
  return Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
}

/** The geldar-tree-v1 hash (GX-02): the same rules as tools/psyche-release/src/tree-hash.ts. */
export function geldarTreeV1(dir: string): {
  tree_hash: string;
  files: Array<{ path: string; sha256: string }>;
} {
  const files = walkFiles(dir).map(({ path, full }) => ({
    path,
    sha256: sha256Hex(lfBytes(readFileSync(full))),
  }));
  const outer = createHash('sha256');
  for (const file of files) outer.update(`${file.path}\0${file.sha256}\n`, 'utf8');
  return { tree_hash: outer.digest('hex'), files };
}

/** Refuses any commit text that is not 40 lower-case hex characters. */
export function checkCommit(commit: string): void {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('--commit must be 40 lower-case hex characters');
  }
}

/** Refuses a source path with a `..` segment. */
export function checkSource(source: string): void {
  if (source.split(/[\\/]+/).includes('..')) throw new Error('--source must not contain ".."');
}

/** Checks the source against RELEASE.json, then copies it into engine/ and writes MIRROR.json. */
export function vendor(options: VendorOptions): { tree_sha256: string; files: string[] } {
  checkCommit(options.commit);
  checkSource(options.source);
  const source = resolve(options.source);
  const releasePath = join(source, '..', 'RELEASE.json');
  if (!existsSync(releasePath)) throw new Error('RELEASE.json is missing next to the source');
  const release = JSON.parse(readFileSync(releasePath, 'utf8')) as ReleaseFile;
  if (release.tree_hash_algorithm !== TREE_ALGORITHM) {
    throw new Error(`RELEASE.json must name ${TREE_ALGORITHM}`);
  }
  const walked = walkFiles(source);
  for (const { path, full } of walked) {
    if (statSync(full).size > MAX_FILE_BYTES) throw new Error(`file over 200 KiB: ${path}`);
  }
  // The check runs before anything is copied: a tampered source leaves engine/ untouched.
  if (geldarTreeV1(source).tree_hash !== release.tree_hash) {
    throw new Error('source does not match RELEASE.json tree_hash; refusing to vendor');
  }

  const engine = join(options.packageRoot, 'engine');
  rmSync(engine, { recursive: true, force: true });
  for (const { path, full } of walked) {
    if (path.endsWith('.test.ts')) continue;
    const target = join(engine, ...path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(full, target);
  }

  const tree_sha256 = treeHash(engine);
  const files = walkFiles(engine).map(({ path }) => path);
  const mirror = {
    source_repo: SOURCE_REPO,
    source_path: SOURCE_PATH,
    source_commit: options.commit,
    source_release_tag: release.tag,
    source_release_tree_hash: release.tree_hash,
    tree_sha256,
    files,
    vendored_by: 'scripts/vendor.ts',
  };
  writeFileSync(
    join(options.packageRoot, 'MIRROR.json'),
    `${JSON.stringify(mirror, null, 2)}\n`,
    'utf8',
  );
  return { tree_sha256, files };
}

function argValue(argv: readonly string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index < 0 ? undefined : argv[index + 1];
  if (value === undefined) throw new Error(`${flag} is required`);
  return value;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const argv = process.argv.slice(2);
  const result = vendor({
    source: argValue(argv, '--source'),
    commit: argValue(argv, '--commit'),
    packageRoot,
  });
  process.stdout.write(`vendored ${result.files.length} files, tree ${result.tree_sha256}\n`);
}
