// The CI pin of the vendored engine: the recorded tree hash, the file list, the purity and import rules,
// the isolation of the temperament bank, and the refusals of scripts/vendor.ts.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  checkCommit,
  checkSource,
  geldarTreeV1,
  MAX_FILE_BYTES,
  RELEASE_TAG,
  treeHash,
  vendor,
  walkFiles,
} from '../scripts/vendor.ts';

interface MirrorRecord {
  source_repo: string;
  source_path: string;
  source_commit: string;
  source_release_tag: string;
  source_release_tree_hash: string;
  tree_sha256: string;
  files: string[];
  vendored_by: string;
}

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(PACKAGE, '..', '..');
const ENGINE = join(PACKAGE, 'engine');
const GOOD_COMMIT = '549e7d0736dc05049cd2c48c7f8aa02191781f9f';
/** Independent anchor: typed here by hand, not read from MIRROR.json or from engine/. */
const RELEASE_TREE_HASH = 'b89848ab21240fbb2e33832d671a51d73e8393b3235807f19fa7a2355c5e4efe';
const MIRROR_KEYS = [
  'source_repo',
  'source_path',
  'source_commit',
  'source_release_tag',
  'source_release_tree_hash',
  'tree_sha256',
  'files',
  'vendored_by',
];
const mirror = JSON.parse(readFileSync(join(PACKAGE, 'MIRROR.json'), 'utf8')) as MirrorRecord;

const FORBIDDEN = [
  'node:fs',
  'node:net',
  'node:http',
  'node:child_process',
  'fetch(',
  'process.env',
  'Date.now',
  'new Date(',
  'performance.now',
  'crypto.random',
  'Math.random',
];

/** The import forms: `from 'x'`, bare `import 'x'`, dynamic `import(` and `require(`. */
const IMPORT_FORM =
  /\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]|\bimport\s*\(|\brequire\s*\(/g;

/** The forms of a file that are neither relative (`./`) nor node:crypto. Dynamic forms are listed. */
export function forbiddenImports(text: string): string[] {
  const bad: string[] = [];
  for (const match of text.matchAll(IMPORT_FORM)) {
    const specifier = match[1] ?? match[2];
    if (specifier === 'node:crypto' || specifier?.startsWith('./')) continue;
    bad.push(match[0]);
  }
  return bad;
}

const TEMPERAMENT_PATTERN = /TEMPERAMENT_BANK|temperamentFor|psyche\/engine\/temperament/;
const SKIP_NAMES = new Set(['.git', 'node_modules', 'dist']);
const SKIP_TOP = new Set(['.claude', 'docs']);
const SCAN_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The files under root whose text names the inactive temperament bank, as POSIX paths. Every file is
 * read except: .git, node_modules and dist at any depth, .claude and docs at the top, packages/psyche,
 * a file with a NUL byte (binary) and a file over 2 MiB. A symbolic link is reported, never followed.
 */
export function temperamentHits(root: string): string[] {
  const hits: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = relative(root, full).split(sep).join('/');
      if (SKIP_NAMES.has(name) || (dir === root && SKIP_TOP.has(name))) continue;
      if (rel === 'packages/psyche' || rel.startsWith('packages/psyche/')) continue;
      const info = lstatSync(full);
      if (info.isSymbolicLink()) hits.push(`${rel}: symbolic link, not followed`);
      else if (info.isDirectory()) visit(full);
      else if (info.isFile() && info.size <= SCAN_MAX_BYTES) {
        const bytes = readFileSync(full);
        if (!bytes.includes(0) && TEMPERAMENT_PATTERN.test(bytes.toString('utf8'))) {
          hits.push(rel);
        }
      }
    }
  };
  visit(root);
  return hits;
}

const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'psyche-vendor-'));
  temps.push(dir);
  return dir;
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** A source directory with RELEASE.json next to it, the hash of which matches the files. */
function makeSource(files: Record<string, string>): { root: string; src: string } {
  const root = tempDir();
  const src = join(root, 'src');
  mkdirSync(src, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeText(join(src, name), text);
  const tree = geldarTreeV1(src);
  writeFileSync(
    join(root, 'RELEASE.json'),
    JSON.stringify({
      format: 1,
      tag: RELEASE_TAG,
      tree_hash_algorithm: 'geldar-tree-v1',
      tree_hash: tree.tree_hash,
      files: tree.files,
    }),
    'utf8',
  );
  return { root, src };
}

/** Changes fields of RELEASE.json next to a source. */
function rewriteRelease(root: string, change: Record<string, unknown>): void {
  const path = join(root, 'RELEASE.json');
  const release = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...release, ...change }), 'utf8');
}

/** A package root with a populated engine/ and a MIRROR.json, the state a refusal must leave alone. */
function seededPackage(): string {
  const packageRoot = tempDir();
  writeText(join(packageRoot, 'engine', 'keep.ts'), 'export const keep = 1;\n');
  writeText(join(packageRoot, 'MIRROR.json'), 'OLD\n');
  return packageRoot;
}

/** Every byte under engine/ and MIRROR.json, as text. */
function snapshot(packageRoot: string): string {
  const parts: string[] = [];
  const engine = join(packageRoot, 'engine');
  if (existsSync(engine)) {
    for (const { path, full } of walkFiles(engine)) {
      parts.push(`${path}\0${readFileSync(full, 'latin1')}`);
    }
  }
  const mirrorPath = join(packageRoot, 'MIRROR.json');
  parts.push(existsSync(mirrorPath) ? `MIRROR\0${readFileSync(mirrorPath, 'latin1')}` : 'MIRROR\0');
  return parts.join('\n');
}

/** Runs a refusing vendor and checks it threw, that engine/ and MIRROR.json are byte-identical after. */
function expectRefused(packageRoot: string, run: () => unknown, message: string | RegExp): void {
  const before = snapshot(packageRoot);
  expect(run).toThrow(message);
  expect(snapshot(packageRoot)).toBe(before);
  expect(existsSync(join(packageRoot, '.engine-staging'))).toBe(false);
  expect(existsSync(join(packageRoot, 'MIRROR.json.tmp'))).toBe(false);
}

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe('mirror', () => {
  it('mirror: recorded tree hash equals the engine and the pinned release hash', () => {
    expect(treeHash(ENGINE)).toBe(mirror.tree_sha256);
    expect(geldarTreeV1(ENGINE).tree_hash).toBe(mirror.tree_sha256);
    expect(geldarTreeV1(ENGINE).tree_hash).toBe(RELEASE_TREE_HASH);
    expect(mirror.tree_sha256).toBe(mirror.source_release_tree_hash);
    expect(mirror.tree_sha256).toBe(RELEASE_TREE_HASH);
  });

  it('mirror: files list matches', () => {
    expect(walkFiles(ENGINE).map(({ path }) => path)).toEqual(mirror.files);
  });

  it('mirror: source commit is 40 hex and the release pin is recorded', () => {
    expect(mirror.source_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(mirror.source_commit).toBe(GOOD_COMMIT);
    expect(mirror.source_release_tag).toBe('psyche-v1.0.0');
    expect(mirror.source_release_tree_hash).toBe(RELEASE_TREE_HASH);
  });

  it('mirror: MIRROR.json has exactly the recorded keys and no timestamp', () => {
    expect(Object.keys(mirror)).toEqual(MIRROR_KEYS);
  });

  it('mirror: no test file, dotfile or node_modules is vendored', () => {
    const bad = walkFiles(ENGINE)
      .map(({ path }) => path)
      .filter(
        (path) =>
          path.endsWith('.test.ts') ||
          path.split('/').some((part) => part.startsWith('.') || part === 'node_modules'),
      );
    expect(bad).toEqual([]);
  });

  it('mirror: engine is pure', () => {
    const hits: string[] = [];
    for (const { path, full } of walkFiles(ENGINE)) {
      const text = readFileSync(full, 'utf8');
      for (const token of FORBIDDEN) {
        if (text.includes(token)) hits.push(`${path}: ${token}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('mirror: engine imports only relative paths and node:crypto', () => {
    const bad: string[] = [];
    for (const { path, full } of walkFiles(ENGINE)) {
      for (const form of forbiddenImports(readFileSync(full, 'utf8'))) {
        bad.push(`${path}: ${form}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('mirror: the import rule catches bare, dynamic and require forms', () => {
    expect(forbiddenImports("import 'left-pad';\n")).toEqual(["import 'left-pad'"]);
    expect(forbiddenImports("import('node:fs');\n")).toEqual(['import(']);
    expect(forbiddenImports("const x = require('fs');\n")).toEqual(['require(']);
    expect(forbiddenImports("import './ok.ts';\nimport { a } from './b.ts';\n")).toEqual([]);
    expect(forbiddenImports("import { c } from 'node:crypto';\n")).toEqual([]);
  });

  it('mirror: nothing outside packages/psyche references the temperament bank', () => {
    expect(temperamentHits(REPO)).toEqual([]);
  });
});

describe('temperament scan', () => {
  const KINDS = [
    'mind/instructions.ts',
    'template/SKILL.md',
    'launcher/messages.tsv',
    'image/allowlist-keeper.txt',
    'packages/stub-cli/birth.jsonl',
    'launcher/config/world.conf',
    'fleet/versions.env',
    'fleet/.env',
    'image/stub.Dockerfile',
    'image/Dockerfile',
    'launcher/geldar-play',
    'tools/zz.mts',
    'tools/zz.jsonc',
    '.trivyignore',
    'sub/deep/noext',
  ];

  for (const kind of KINDS) {
    it(`temperament scan: finds a reference in ${kind}`, () => {
      const root = tempDir();
      writeText(join(root, kind), 'const x = temperamentFor(1);\n');
      expect(temperamentHits(root)).toEqual([kind]);
    });
  }

  it('temperament scan: finds the bank name and the engine path too', () => {
    const root = tempDir();
    writeText(join(root, 'a.txt'), 'TEMPERAMENT_BANK\n');
    writeText(join(root, 'b.txt'), "from 'psyche/engine/temperament'\n");
    expect(temperamentHits(root)).toEqual(['a.txt', 'b.txt']);
  });

  it('temperament scan: the bare word temperament is not a hit', () => {
    const root = tempDir();
    writeText(join(root, 'render.ts'), 'export const renderTemperament = 1;\nthe temperament\n');
    expect(temperamentHits(root)).toEqual([]);
  });

  it('temperament scan: skips only the excluded places', () => {
    const root = tempDir();
    const text = 'temperamentFor\n';
    for (const place of [
      'packages/psyche/src/x.ts',
      'docs/x.md',
      '.claude/x.md',
      'node_modules/x.ts',
      'dist/x.js',
      '.git/x.txt',
      'packages/other/node_modules/x.ts',
    ]) {
      writeText(join(root, place), text);
    }
    writeText(join(root, 'tools/.claude/x.md'), text);
    expect(temperamentHits(root)).toEqual(['tools/.claude/x.md']);
  });

  it('temperament scan: a NUL byte or a file over 2 MiB is skipped as binary', () => {
    const root = tempDir();
    writeText(join(root, 'bin.dat'), `\0temperamentFor\n`);
    writeText(join(root, 'big.txt'), `${'x'.repeat(2 * 1024 * 1024)}temperamentFor\n`);
    expect(temperamentHits(root)).toEqual([]);
  });

  it('temperament scan: reports a symbolic link rather than following it', () => {
    const root = tempDir();
    const other = tempDir();
    writeText(join(other, 'x.txt'), 'temperamentFor\n');
    symlinkSync(other, join(root, 'linked'), 'junction');
    expect(temperamentHits(root)).toEqual(['linked: symbolic link, not followed']);
  });
});

describe('vendor', () => {
  it('vendor: refuses a bad commit text and writes nothing', () => {
    const badCommits = [
      '',
      '549E7D0736DC05049CD2C48C7F8AA02191781F9F',
      '549e7d0736dc05049cd2c48c7f8aa02191781f9',
      '549e7d0736dc05049cd2c48c7f8aa02191781f9f0',
      ' 549e7d0736dc05049cd2c48c7f8aa02191781f9f',
      '549e7d0736dc05049cd2c48c7f8aa0219178zz9f',
    ];
    for (const commit of badCommits) {
      expect(() => checkCommit(commit)).toThrow('40 lower-case hex');
    }
    expect(() => checkCommit(GOOD_COMMIT)).not.toThrow();

    const { src } = makeSource({ 'a.ts': 'export const a = 1;\n' });
    const packageRoot = seededPackage();
    for (const commit of badCommits) {
      expectRefused(
        packageRoot,
        () => vendor({ source: src, commit, packageRoot }),
        '40 lower-case hex',
      );
    }
  });

  it('vendor: refuses a symlink inside the source and leaves the old engine', () => {
    const { src } = makeSource({ 'a.ts': 'export const a = 1;\n' });
    symlinkSync(tempDir(), join(src, 'linked'), 'junction');
    const packageRoot = seededPackage();
    expectRefused(
      packageRoot,
      () => vendor({ source: src, commit: GOOD_COMMIT, packageRoot }),
      'symbolic link',
    );
  });

  it('vendor: refuses a source root that is itself a junction', () => {
    const { root, src } = makeSource({ 'a.ts': 'export const a = 1;\n' });
    const link = join(root, 'linked');
    symlinkSync(src, link, 'junction');
    const packageRoot = seededPackage();
    expectRefused(
      packageRoot,
      () => vendor({ source: link, commit: GOOD_COMMIT, packageRoot }),
      'symbolic link as the source root',
    );
  });

  it('vendor: refuses a source path with .. and accepts a plain one', () => {
    expect(() => checkSource('../psyche/src')).toThrow('".."');
    expect(() => checkSource('C:\\x\\..\\src')).toThrow('".."');
    expect(() => checkSource('C:\\x\\src')).not.toThrow();

    const { src } = makeSource({ 'a.ts': 'export const a = 1;\n' });
    const packageRoot = seededPackage();
    expectRefused(
      packageRoot,
      () => vendor({ source: `${src}/../src`, commit: GOOD_COMMIT, packageRoot }),
      '".."',
    );
  });

  it('vendor: refuses a file of 204801 bytes and accepts exactly 204800', () => {
    expect(MAX_FILE_BYTES).toBe(204800);
    const over = makeSource({ 'big.ts': 'x'.repeat(MAX_FILE_BYTES + 1) });
    const packageRoot = seededPackage();
    expectRefused(
      packageRoot,
      () => vendor({ source: over.src, commit: GOOD_COMMIT, packageRoot }),
      'over 200 KiB',
    );

    const exact = makeSource({ 'big.ts': 'x'.repeat(MAX_FILE_BYTES) });
    const accepted = tempDir();
    const result = vendor({ source: exact.src, commit: GOOD_COMMIT, packageRoot: accepted });
    expect(result.files).toEqual(['big.ts']);
    expect(readFileSync(join(accepted, 'engine', 'big.ts')).length).toBe(MAX_FILE_BYTES);
  });

  it('vendor: refuses a RELEASE.json with a bad tag, a bad hash or no JSON', () => {
    const packageRoot = seededPackage();

    const badTag = makeSource({ 'a.ts': 'export {};\n' });
    rewriteRelease(badTag.root, { tag: 'v1.0.0' });
    expectRefused(
      packageRoot,
      () => vendor({ source: badTag.src, commit: GOOD_COMMIT, packageRoot }),
      'tag must match',
    );

    const badHash = makeSource({ 'a.ts': 'export {};\n' });
    rewriteRelease(badHash.root, { tree_hash: 'ABC' });
    expectRefused(
      packageRoot,
      () => vendor({ source: badHash.src, commit: GOOD_COMMIT, packageRoot }),
      'tree_hash must be 64',
    );

    const notJson = makeSource({ 'a.ts': 'export {};\n' });
    writeFileSync(join(notJson.root, 'RELEASE.json'), 'not json', 'utf8');
    expectRefused(
      packageRoot,
      () => vendor({ source: notJson.src, commit: GOOD_COMMIT, packageRoot }),
      /not valid JSON|Unexpected token/,
    );

    const missing = makeSource({ 'a.ts': 'export {};\n' });
    rmSync(join(missing.root, 'RELEASE.json'));
    expectRefused(
      packageRoot,
      () => vendor({ source: missing.src, commit: GOOD_COMMIT, packageRoot }),
      'RELEASE.json is missing',
    );
  });

  it('vendor: refuses a tampered source and leaves the old engine', () => {
    const { src } = makeSource({ 'a.ts': 'export const a = 1;\n', 'b.ts': 'export {};\n' });
    writeFileSync(join(src, 'a.ts'), 'export const a = 2;\n', 'utf8');
    const packageRoot = seededPackage();
    expectRefused(
      packageRoot,
      () => vendor({ source: src, commit: GOOD_COMMIT, packageRoot }),
      'does not match RELEASE.json',
    );
  });

  it('vendor: refuses an empty source and leaves the old engine', () => {
    const { src } = makeSource({});
    const packageRoot = seededPackage();
    expectRefused(
      packageRoot,
      () => vendor({ source: src, commit: GOOD_COMMIT, packageRoot }),
      'no engine files',
    );
  });

  it('vendor: copies the source byte for byte, leaves test files out and replaces the engine', () => {
    const { src } = makeSource({
      'a.ts': 'export const a = 1;\r\n',
      'b.ts': 'export {};\n',
      'a.test.ts': 'x\n',
    });
    const packageRoot = seededPackage();
    const result = vendor({ source: src, commit: GOOD_COMMIT, packageRoot });
    expect(result.files).toEqual(['a.ts', 'b.ts']);
    expect(existsSync(join(packageRoot, 'engine', 'keep.ts'))).toBe(false);
    const copied = readFileSync(join(packageRoot, 'engine', 'a.ts'));
    expect(copied.equals(readFileSync(join(src, 'a.ts')))).toBe(true);
    const record = JSON.parse(
      readFileSync(join(packageRoot, 'MIRROR.json'), 'utf8'),
    ) as MirrorRecord;
    expect(record.tree_sha256).toBe(treeHash(join(packageRoot, 'engine')));
    expect(record.source_release_tag).toBe(RELEASE_TAG);
    expect(existsSync(join(packageRoot, '.engine-staging'))).toBe(false);
  });

  it('vendor: two runs give byte-identical MIRROR.json with the recorded keys', () => {
    const { src } = makeSource({ 'a.ts': 'export const a = 1;\n' });
    const packageRoot = tempDir();
    vendor({ source: src, commit: GOOD_COMMIT, packageRoot });
    const first = readFileSync(join(packageRoot, 'MIRROR.json'));
    vendor({ source: src, commit: GOOD_COMMIT, packageRoot });
    expect(readFileSync(join(packageRoot, 'MIRROR.json')).equals(first)).toBe(true);
    const elsewhere = tempDir();
    vendor({ source: src, commit: GOOD_COMMIT, packageRoot: elsewhere });
    expect(readFileSync(join(elsewhere, 'MIRROR.json')).equals(first)).toBe(true);
    const record = JSON.parse(first.toString('utf8')) as Record<string, unknown>;
    expect(Object.keys(record)).toEqual(MIRROR_KEYS);
    expect(Object.keys(record).filter((key) => /time|date|stamp|_at$/i.test(key))).toEqual([]);
  });
});
