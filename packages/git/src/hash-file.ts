import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { sep } from 'node:path';
import { runGit } from './run-git.ts';

export const MAX_FILE_BYTES = 1048576;

export type HashRefusalCode =
  | 'file_too_large'
  | 'not_regular'
  | 'symlink'
  | 'hard_linked'
  | 'swapped'
  | 'outside_root';

export class HashRefusal extends Error {
  code: HashRefusalCode;

  constructor(code: HashRefusalCode, message?: string) {
    super(message ?? code);
    this.name = 'HashRefusal';
    this.code = code;
  }
}

export interface HashOptions {
  write: boolean;
  // dev and ino from the lstat taken at classification.
  expect?: { dev: number; ino: number };
  maxBytes?: number;
  // Test seam: runs after the open and fstat, before the read.
  afterFstat?: () => void;
}

// Opens the file once with O_NOFOLLOW, checks the open descriptor, reads at most cap + 1 bytes from it
// and hashes those bytes, so classification and hashing use the same open file.
export function hashRegularFile(root: string, absPath: string, opts: HashOptions): string {
  const cap = opts.maxBytes ?? MAX_FILE_BYTES;
  // On win32 O_NOFOLLOW is undefined; the dev/ino comparison is the only guard there.
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  let fd: number;
  try {
    fd = openSync(absPath, flags);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ELOOP') throw new HashRefusal('symlink');
    throw new HashRefusal('not_regular', `cannot open: ${code ?? 'error'}`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new HashRefusal('not_regular');
    if (st.nlink !== 1) throw new HashRefusal('hard_linked');
    if (st.size > cap) throw new HashRefusal('file_too_large');
    if (opts.expect && (st.dev !== opts.expect.dev || st.ino !== opts.expect.ino)) {
      throw new HashRefusal('swapped');
    }
    if (process.platform === 'linux') {
      let real: string;
      try {
        real = realpathSync(`/proc/self/fd/${fd}`);
      } catch {
        throw new HashRefusal('outside_root');
      }
      const base = realpathSync(root);
      if (!real.startsWith(base.endsWith(sep) ? base : base + sep)) {
        throw new HashRefusal('outside_root');
      }
    }
    opts.afterFstat?.();
    const buf = Buffer.alloc(cap + 1);
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, null);
      if (n === 0) break;
      got += n;
    }
    if (got > cap) throw new HashRefusal('file_too_large');
    return runGit(
      root,
      ['hash-object', '--no-filters', ...(opts.write ? ['-w'] : []), '--stdin'],
      undefined,
      buf.subarray(0, got),
    ).trim();
  } finally {
    closeSync(fd);
  }
}
