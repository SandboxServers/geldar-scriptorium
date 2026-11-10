/**
 * Which CI jobs a pull request needs, from the paths it changed. Pure over a list of paths; the
 * cli (ci-scope-cli.ts) reads the list. Fail open: an empty list, a bad entry, or any error
 * turns every job on, and a non-markdown path no rule knows turns `rest` on. A mistake here
 * runs more checks, never fewer. Main and manual runs never call this (ci.yml sets everything on).
 */
import { basename } from 'node:path';

export interface Scope {
  /** Always true: lint, typecheck and the repo checks are cheap and run on every change. */
  static: boolean;
  /** The hostile tests (launcher/test/hostile/). Only for launcher-side changes. */
  hostile: boolean;
  /** The other launcher tests (launcher/test/). Only for launcher-side changes. */
  launcher: boolean;
  /** The image tests: tests/image/, tests/hostile/, tests/template/. */
  image: boolean;
  /** Every other vitest file. Also on for any non-markdown path no rule knows. */
  rest: boolean;
  /** The end-to-end job: launcher, image, packages, template, release, workflows, toolchain. */
  e2e: boolean;
  /** The markdown lint job: any changed .md file. */
  markdown: boolean;
}

export const ALL: Scope = {
  static: true,
  hostile: true,
  launcher: true,
  image: true,
  rest: true,
  e2e: true,
  markdown: true,
};

/** Changes to code or fixtures that a vitest group runs against (template/ is read by tests). */
const SUITE_PREFIXES = [
  'launcher/',
  'image/',
  'packages/',
  'template/',
  'tools/',
  '.github/workflows/',
];
/** Changes that can reach the hostile and launcher groups. template/ counts only for non-markdown. */
const LAUNCHER_PREFIXES = [
  'launcher/',
  'image/',
  'packages/',
  'tools/release/',
  '.github/workflows/',
];
const E2E_PREFIXES = [
  'launcher/',
  'image/',
  'packages/',
  'template/',
  'tests/e2e/',
  'tools/release/',
  '.github/workflows/',
];
/** Matched by basename, so a nested package.json or tsconfig counts too (fails open). */
const TOOLCHAIN_BASENAMES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.nvmrc'];
const TOOLCHAIN_PATTERNS = [/^vitest\.config\./, /^tsconfig.*\.json$/];
/** Markdown that a test reads (conservative list). A change to it keeps rest and image on. */
const MARKDOWN_READ_FILES = ['docs/linux-tests.md', 'docs/release.md', 'docs/ci.md'];
/** Paths whose markdown changes cannot affect a test: notes and agent memory. */
const DOCS_PREFIXES = ['docs/analysis/', '.claude/agent-memory/'];

/** Forward slashes, no leading `./`. */
function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function startsWithAny(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path.startsWith(prefix));
}

function isMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

function isDocsOnly(path: string): boolean {
  return isMarkdown(path) && startsWithAny(path, DOCS_PREFIXES);
}

function isToolchain(path: string): boolean {
  const name = basename(path);
  return TOOLCHAIN_BASENAMES.includes(name) || TOOLCHAIN_PATTERNS.some((re) => re.test(name));
}

/** A change that the vitest groups run against. tests/e2e is its own job, so it is not here. */
function isSuite(path: string): boolean {
  if (isToolchain(path)) return true;
  if (path.startsWith('tests/')) return !path.startsWith('tests/e2e/');
  return startsWithAny(path, SUITE_PREFIXES);
}

/** A change that can reach the hostile and launcher groups. */
function isLauncherSide(path: string): boolean {
  if (isToolchain(path)) return true;
  if (path.startsWith('template/')) return !isMarkdown(path);
  return startsWithAny(path, LAUNCHER_PREFIXES);
}

function isE2e(path: string): boolean {
  return startsWithAny(path, E2E_PREFIXES) || isToolchain(path);
}

/** The jobs a change needs. `files` is the changed paths; anything unusual returns ALL. */
export function scopeFor(files: unknown): Scope {
  if (!Array.isArray(files) || files.length === 0) return { ...ALL };
  if (!files.every((f) => typeof f === 'string' && f.trim() !== '')) return { ...ALL };
  const paths = files.map((f: string) => normalize(f.trim()));
  const code = paths.filter((p) => !isDocsOnly(p));
  const suite = (p: string) => isSuite(p) || MARKDOWN_READ_FILES.includes(p);
  return {
    static: true,
    hostile: code.some(isLauncherSide),
    launcher: code.some(isLauncherSide),
    image: code.some(suite),
    rest: code.some((p) => suite(p) || !isMarkdown(p)),
    e2e: paths.some(isE2e),
    markdown: paths.some(isMarkdown),
  };
}

/** Newline-separated paths, as `git diff --name-only` prints them. Blank lines are dropped. */
export function parsePaths(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '');
}

/** The `key=value` lines CI appends to $GITHUB_OUTPUT. */
export function outputLines(scope: Scope): string[] {
  return Object.entries(scope).map(([key, on]) => `${key}=${on ? 'true' : 'false'}`);
}
