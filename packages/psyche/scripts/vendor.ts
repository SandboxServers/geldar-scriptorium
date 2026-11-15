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
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The tag of the release this mirror is pinned to. */
export const RELEASE_TAG = 'psyche-v1.0.0';
/** The largest file the vendor copies: 200 KiB exactly is accepted, one byte more is refused. */
export const MAX_FILE_BYTES = 200 * 1024;

const SOURCE_REPO = 'SandboxServers/geldar';
const SOURCE_PATH = 'psyche/src';
const TREE_ALGORITHM = 'geldar-tree-v1';
const RELEASE_TAG_FORM = /^psyche-v\d+\.\d+\.\d+$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
/** The directory the copy is built in, inside the package; removed on success and on failure. */
const STAGING = '.engine-staging';
const MIRROR_TMP = 'MIRROR.json.tmp';

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

/** Refuses a RELEASE.json that does not name the algorithm, a tag of the release form, or a hash. */
export function checkRelease(release: unknown): asserts release is ReleaseFile {
  if (typeof release !== 'object' || release === null) {
    throw new Error('RELEASE.json must be a JSON object');
  }
  const fields = release as Partial<ReleaseFile>;
  if (fields.tree_hash_algorithm !== TREE_ALGORITHM) {
    throw new Error(`RELEASE.json must name ${TREE_ALGORITHM}`);
  }
  if (typeof fields.tag !== 'string' || !RELEASE_TAG_FORM.test(fields.tag)) {
    throw new Error('RELEASE.json tag must match psyche-vMAJOR.MINOR.PATCH');
  }
  if (typeof fields.tree_hash !== 'string' || !HEX_SHA256.test(fields.tree_hash)) {
    throw new Error('RELEASE.json tree_hash must be 64 lower-case hex characters');
  }
}

/**
 * Checks the source, builds the copy in a staging directory, and only then replaces engine/ and
 * MIRROR.json. Every refusal happens before engine/ is touched, so a failed run leaves it as it was.
 */
export function vendor(options: VendorOptions): { tree_sha256: string; files: string[] } {
  checkCommit(options.commit);
  checkSource(options.source);
  const source = resolve(options.source);
  if (lstatSync(source).isSymbolicLink()) {
    throw new Error('refusing a symbolic link as the source root');
  }
  const releasePath = join(source, '..', 'RELEASE.json');
  if (!existsSync(releasePath)) throw new Error('RELEASE.json is missing next to the source');
  const release: unknown = JSON.parse(readFileSync(releasePath, 'utf8'));
  checkRelease(release);
  const walked = walkFiles(source);
  for (const { path, full } of walked) {
    if (statSync(full).size > MAX_FILE_BYTES) throw new Error(`file over 200 KiB: ${path}`);
  }
  const copied = walked.filter(({ path }) => !path.endsWith('.test.ts'));
  if (copied.length === 0) throw new Error('the source has no engine files to vendor');
  if (geldarTreeV1(source).tree_hash !== release.tree_hash) {
    throw new Error('source does not match RELEASE.json tree_hash; refusing to vendor');
  }

  const engine = join(options.packageRoot, 'engine');
  const staging = join(options.packageRoot, STAGING);
  const mirrorPath = join(options.packageRoot, 'MIRROR.json');
  const mirrorTmp = join(options.packageRoot, MIRROR_TMP);
  rmSync(staging, { recursive: true, force: true });
  try {
    for (const { path, full } of copied) {
      const target = join(staging, ...path.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(full, target);
    }
    const tree_sha256 = treeHash(staging);
    const files = walkFiles(staging).map(({ path }) => path);
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
    writeFileSync(mirrorTmp, `${JSON.stringify(mirror, null, 2)}\n`, 'utf8');
    // Every check and the copy have passed: only now is the old engine replaced.
    rmSync(engine, { recursive: true, force: true });
    renameSync(staging, engine);
    renameSync(mirrorTmp, mirrorPath);
    return { tree_sha256, files };
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(mirrorTmp, { force: true });
  }
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
