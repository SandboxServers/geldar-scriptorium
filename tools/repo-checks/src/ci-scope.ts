/**
 * Which CI jobs a pull request needs, from the paths it changed. Pure over a list of paths; the
 * cli (ci-scope-cli.ts) reads the list. Fail open: an empty list, a bad entry, or any error
 * turns every job on, so a mistake here runs more checks, never fewer. Main and manual runs
 * never call this (ci.yml sets everything on for them).
 */
import { basename } from 'node:path';

export interface Scope {
  /** Always true: lint, typecheck and the repo checks are cheap and run on every change. */
  static: boolean;
  /** The vitest matrix. False only for docs-only changes. */
  tests: boolean;
  /** The end-to-end job: launcher, image, packages, template, release, workflows, toolchain. */
  e2e: boolean;
  /** The markdown lint job: any changed .md file. */
  markdown: boolean;
}

export const ALL: Scope = { static: true, tests: true, e2e: true, markdown: true };

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
const E2E_BASENAMES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.nvmrc'];
const E2E_BASENAME_PATTERNS = [/^vitest\.config\./, /^tsconfig.*\.json$/];
/** Paths whose markdown changes cannot affect a test: notes and agent memory. */
const DOCS_PREFIXES = ['docs/analysis/', '.claude/agent-memory/'];

/** Forward slashes, no leading `./`. */
function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isDocsOnly(path: string): boolean {
  return path.endsWith('.md') && DOCS_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isE2e(path: string): boolean {
  if (E2E_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  const name = basename(path);
  return E2E_BASENAMES.includes(name) || E2E_BASENAME_PATTERNS.some((re) => re.test(name));
}

/** The jobs a change needs. `files` is the changed paths; anything unusual returns ALL. */
export function scopeFor(files: unknown): Scope {
  if (!Array.isArray(files) || files.length === 0) return { ...ALL };
  if (!files.every((f) => typeof f === 'string' && f.trim() !== '')) return { ...ALL };
  const paths = files.map((f: string) => normalize(f.trim()));
  return {
    static: true,
    tests: !paths.every(isDocsOnly),
    e2e: paths.some(isE2e),
    markdown: paths.some((p) => p.toLowerCase().endsWith('.md')),
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
