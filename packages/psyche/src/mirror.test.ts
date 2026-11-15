// The CI pin of the vendored engine: the recorded tree hash, the file list, the purity and import rules,
// the isolation of the temperament bank, and the argument checks of scripts/vendor.ts.
import {
  cpSync,
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
import { dirname, join, relative, resolve } from 'node:path';
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
const RELEASE_TREE_HASH = 'b89848ab21240fbb2e33832d671a51d73e8393b3235807f19fa7a2355c5e4efe';
const mirror = JSON.parse(readFileSync(join(PACKAGE, 'MIRROR.json'), 'utf8')) as MirrorRecord;

const FORBIDDEN = [
  'node:fs',
  'node:net',
  'node:http',
  'node:child_process',
  'fetch(',
  'process.env',
  'Date.now',
  'Math.random',
];

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.sh',
  '.ps1',
  '.yaml',
  '.yml',
  '.tsv',
]);
const TEXT_NAMES = new Set(['Dockerfile', '.dockerignore', '.gitignore']);
const SKIP_EVERYWHERE = new Set(['node_modules', '.git']);
const SKIP_AT_TOP = new Set(['.claude', 'docs']);

/** Text files of the repository, leaving out packages/psyche, docs and .claude. */
function repoTextFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (full === PACKAGE || SKIP_EVERYWHERE.has(name)) continue;
    if (dir === REPO && SKIP_AT_TOP.has(name)) continue;
    const info = lstatSync(full);
    if (info.isDirectory()) repoTextFiles(full, out);
    else if (info.isFile()) {
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 ? name.slice(dot) : '';
      if (TEXT_EXTENSIONS.has(ext) || TEXT_NAMES.has(name)) out.push(full);
    }
  }
  return out;
}

const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'psyche-vendor-'));
  temps.push(dir);
  return dir;
}

/** A source directory with RELEASE.json next to it, the hash of which matches the files. */
function makeSource(files: Record<string, string>): { root: string; src: string } {
  const root = tempDir();
  const src = join(root, 'src');
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(src, name)), { recursive: true });
    writeFileSync(join(src, name), text, 'utf8');
  }
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

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe('mirror', () => {
  it('mirror: recorded tree hash equals the engine directory', () => {
    expect(treeHash(ENGINE)).toBe(mirror.tree_sha256);
    expect(geldarTreeV1(ENGINE).tree_hash).toBe(mirror.tree_sha256);
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
      const text = readFileSync(full, 'utf8');
      for (const match of text.matchAll(
        /\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(|\brequire\s*\(/g,
      )) {
        const specifier = match[1];
        if (specifier === undefined || specifier === 'node:crypto' || specifier.startsWith('./'))
          continue;
        bad.push(`${path}: ${match[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('mirror: nothing outside packages/psyche references temperament', () => {
    const hits = repoTextFiles(REPO)
      .filter((file) => /temperament|TEMPERAMENT_BANK/i.test(readFileSync(file, 'utf8')))
      .map((file) => relative(REPO, file));
    expect(hits).toEqual([]);
  });
});

describe('vendor', () => {
  it('vendor: refuses a bad commit text and a symlink', () => {
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

    const { root, src } = makeSource({ 'a.ts': 'export const a = 1;\n' });
    const other = tempDir();
    symlinkSync(other, join(src, 'linked'), 'junction');
    const packageRoot = tempDir();
    expect(() => vendor({ source: src, commit: GOOD_COMMIT, packageRoot })).toThrow(
      'symbolic link',
    );
    expect(existsSync(join(packageRoot, 'engine'))).toBe(false);
    expect(existsSync(join(root, 'RELEASE.json'))).toBe(true);
  });

  it('vendor: refuses a source path with .. and a file over 200 KiB', () => {
    expect(() => checkSource('../psyche/src')).toThrow('".."');
    expect(() => checkSource('C:\\x\\..\\src')).toThrow('".."');
    expect(() => checkSource('C:\\x\\src')).not.toThrow();

    const big = 'x'.repeat(MAX_FILE_BYTES + 1);
    const { src } = makeSource({ 'big.ts': big });
    const packageRoot = tempDir();
    expect(() => vendor({ source: src, commit: GOOD_COMMIT, packageRoot })).toThrow('over 200 KiB');
    expect(existsSync(join(packageRoot, 'engine'))).toBe(false);
  });

  it('vendor: copies the source byte for byte and leaves test files out', () => {
    const { src } = makeSource({
      'a.ts': 'export const a = 1;\r\n',
      'b.ts': 'export {};\n',
      'a.test.ts': 'x\n',
    });
    const packageRoot = tempDir();
    const result = vendor({ source: src, commit: GOOD_COMMIT, packageRoot });
    expect(result.files).toEqual(['a.ts', 'b.ts']);
    const copied = readFileSync(join(packageRoot, 'engine', 'a.ts'));
    expect(copied.equals(readFileSync(join(src, 'a.ts')))).toBe(true);
    const record = JSON.parse(
      readFileSync(join(packageRoot, 'MIRROR.json'), 'utf8'),
    ) as MirrorRecord;
    expect(record.tree_sha256).toBe(treeHash(join(packageRoot, 'engine')));
    expect(record.source_release_tag).toBe(RELEASE_TAG);
  });

  it('vendor: refuses a tampered source and writes nothing', () => {
    const { root, src } = makeSource({ 'a.ts': 'export const a = 1;\n', 'b.ts': 'export {};\n' });
    const copy = tempDir();
    cpSync(src, join(copy, 'src'), { recursive: true });
    writeFileSync(join(copy, 'RELEASE.json'), readFileSync(join(root, 'RELEASE.json')));
    writeFileSync(join(copy, 'src', 'a.ts'), 'export const a = 2;\n', 'utf8');
    const packageRoot = tempDir();
    expect(() => vendor({ source: join(copy, 'src'), commit: GOOD_COMMIT, packageRoot })).toThrow(
      'does not match RELEASE.json',
    );
    expect(existsSync(join(packageRoot, 'engine'))).toBe(false);
    expect(existsSync(join(packageRoot, 'MIRROR.json'))).toBe(false);
  });
});
