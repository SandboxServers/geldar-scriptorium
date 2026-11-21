import { chmodSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface WalkFs {
  readdir: (path: string) => string[];
}

const realFs: WalkFs = { readdir: (path) => readdirSync(path) };

// Directories 0755 and files 0644 so the container can read them; a no-op on Windows.
// A container's git can delete its own lock files (for example objects/maintenance.lock from a
// detached `git maintenance`) between the listing and the chmod, so a vanished entry is skipped.
export function openForContainer(path: string, fs: WalkFs = realFs): void {
  try {
    if (statSync(path).isDirectory()) {
      chmodSync(path, 0o755);
      for (const entry of fs.readdir(path)) openForContainer(join(path, entry), fs);
    } else {
      chmodSync(path, 0o644);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
