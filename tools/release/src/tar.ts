// A small ustar writer. Reproducible by construction: the caller sorts the entries, and uid, gid,
// owner names and mtime are fixed. Regular files only (no directory entries, no links).
import { gzipSync } from 'node:zlib';

export interface TarEntry {
  path: string;
  data: Buffer;
  mode: number;
}

const BLOCK = 512;

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function put(buf: Buffer, offset: number, text: string): void {
  buf.write(text, offset, 'latin1');
}

// Splits a path that does not fit the 100-byte name field at a slash into prefix and name.
function splitPath(path: string): { prefix: string; name: string } {
  if (Buffer.byteLength(path) <= 100) return { prefix: '', name: path };
  for (let i = path.length - 1; i > 0; i--) {
    if (path[i] !== '/') continue;
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { prefix, name };
  }
  throw new Error(`path too long for ustar: ${path}`);
}

function header(entry: TarEntry): Buffer {
  const h = Buffer.alloc(BLOCK);
  const { prefix, name } = splitPath(entry.path);
  put(h, 0, name);
  put(h, 100, octal(entry.mode, 8));
  put(h, 108, octal(0, 8));
  put(h, 116, octal(0, 8));
  put(h, 124, octal(entry.data.length, 12));
  put(h, 136, octal(0, 12));
  put(h, 148, '        ');
  put(h, 156, '0');
  put(h, 257, 'ustar\0');
  put(h, 263, '00');
  put(h, 345, prefix);
  let sum = 0;
  for (const b of h) sum += b;
  put(h, 148, `${sum.toString(8).padStart(6, '0')}\0 `);
  return h;
}

export function tarBytes(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    parts.push(header(e), e.data);
    const pad = (BLOCK - (e.data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

// gzip with a zero header time and a fixed OS byte, so the bytes do not depend on the platform.
export function tarGz(entries: TarEntry[]): Buffer {
  const gz = gzipSync(tarBytes(entries), { level: 9 });
  gz.writeUInt32LE(0, 4);
  gz[8] = 0;
  gz[9] = 3;
  return gz;
}
