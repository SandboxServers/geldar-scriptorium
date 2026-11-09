import { BUILT_FLAG, buildKit, dockerReady, KIT_IMAGE } from './docker.ts';

// Vitest globalSetup: build the kit image once, before any worker starts. Workers inherit the
// flag, so each file's buildKit() is a no-op and concurrent `docker build -t` never collides.
export default function setup(): void {
  if (!dockerReady()) return;
  buildKit();
  process.env[BUILT_FLAG] = KIT_IMAGE;
}
