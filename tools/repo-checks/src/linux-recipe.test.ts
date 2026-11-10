import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoPath = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const DOC = readFileSync(repoPath('docs/linux-tests.md'), 'utf8');
const DOCKERFILE = readFileSync(repoPath('image/Dockerfile'), 'utf8');

// The base of the first stage: `FROM node:<tag>@sha256:<64 hex>`.
const BASE = DOCKERFILE.match(/^FROM (node:[^\s@]+)@sha256:([0-9a-f]{64})\b/m);
const BASE_REF = BASE ? `${BASE[1]}@sha256:${BASE[2]}` : '';

// A token names a file when it is a relative path with a slash that ends in a
// directory slash, a file extension, or a Dockerfile name. Prose such as
// "and/or" does not match.
const namesFile = (token: string) =>
  /^[\w.-]+(\/[\w.-]+)*\/?$/.test(token) &&
  token.includes('/') &&
  (token.endsWith('/') || /\.[A-Za-z0-9]+$/.test(token) || token.endsWith('Dockerfile'));

const tokens = DOC.split(/\s+/).map((t) => t.replace(/^["'`(]+|["'`);,]+$/g, ''));
const named = [...new Set(tokens.filter(namesFile))];

const OTHER_IP = /\b(?!127\.0\.0\.1\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;

describe('docs/linux-tests.md', () => {
  it('names the Dockerfile base image by the same digest, every time', () => {
    expect(BASE).not.toBeNull();
    expect(DOC).toContain(BASE_REF);
    const digests = [...DOC.matchAll(/@sha256:([0-9a-f]{64})/g)].map((m) => m[1]);
    expect(digests.length).toBeGreaterThan(0);
    expect(digests.filter((d) => d !== BASE?.[2])).toEqual([]);
  });

  it('names only files and directories that exist', () => {
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((p) => !existsSync(repoPath(p)))).toEqual([]);
  });

  it('contains no IP address other than 127.0.0.1', () => {
    expect(DOC.match(OTHER_IP) ?? []).toEqual([]);
  });
});
