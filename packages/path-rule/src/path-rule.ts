export type Mode = 'play' | 'setup';

export const IDENTITY_PATH = 'memory/identity.md';

const FIXED_ALLOWED: ReadonlySet<string> = new Set([
  'memory/people/.gitkeep',
  'memory/journal/current.md',
]);
const SHAPE = /^(memory|skills)\/[A-Za-z0-9._/-]+\.(md|js|json)$/;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const MAX_PATH_LENGTH = 200;
const MAX_COMPONENT_LENGTH = 64;

function isMode(mode: unknown): mode is Mode {
  return mode === 'play' || mode === 'setup';
}

export function isIdentityPath(path: string): boolean {
  return path.toLowerCase() === IDENTITY_PATH;
}

export function identityLocked(mode: Mode): boolean {
  return mode === 'play';
}

export function isAllowedPath(path: string, mode: Mode): boolean {
  if (typeof path !== 'string' || !isMode(mode)) return false;
  if (isIdentityPath(path)) return path === IDENTITY_PATH && !identityLocked(mode);
  // A case-folded directory named like the identity file would replace it on a case-insensitive host.
  if (path.toLowerCase().startsWith(`${IDENTITY_PATH}/`)) return false;
  if (FIXED_ALLOWED.has(path)) return true;
  if (!SHAPE.test(path)) return false;

  const parts = path.split('/');
  for (const part of parts) {
    if (part === '' || part.startsWith('.') || part.endsWith('.')) return false;
    const stem = part.split('.')[0] ?? '';
    if (RESERVED.test(stem)) return false;
  }

  if (path.length > MAX_PATH_LENGTH) return false;
  if (parts.some((part) => part.length > MAX_COMPONENT_LENGTH)) return false;
  return true;
}
