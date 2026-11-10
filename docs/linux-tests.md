# Run the Linux-only tests in a container

Some test files need Linux, a POSIX `bash`, or `jq`. The author machine is Windows without `jq` and without a Linux shell, so those files skip there. CI runs them. Before you push a change to one of them, run the file in a container with the commands below. A container run does not replace CI.

## The image

Use the Node base image that `image/Dockerfile` builds from, by digest:

`node:22.23.4-trixie-slim@sha256:be1e2a3dc2c4fd68cdfadad2a696a280e0d2749098bee509230174d72fb768c6`

The digest must stay equal to the one in `image/Dockerfile`. A test in `tools/repo-checks/src/linux-recipe.test.ts` checks that.

## Files that need Linux, jq or bash

- `launcher/test/upgrade.bash.test.ts`
- `launcher/test/hostile/collision.bash.test.ts`
- `launcher/test/hostile/mcpurl.bash.test.ts`
- `launcher/test/hostile/statedir.bash.test.ts`
- `tests/hostile/h18-hooks.test.ts` (needs `bash` and `jq`)

The bash twins are the `*.bash.test.ts` files. Each one skips on Windows with a visible reason.

## What cannot run in a container

The image tests in `tests/image/` and the end-to-end tests in `tests/e2e/` build the kit image and call `docker`. A container has no Docker daemon, so they cannot run there. CI runs them on a host with Docker.

## Commands

The command copies the repo into the container with `tar`, so the mounted source stays read-only and `node_modules` from the host is never used. It installs `git`, `jq` and `bash`, installs the pinned pnpm (`pnpm@12.15.0`, the `packageManager` in `package.json`), runs `pnpm install --frozen-lockfile` inside the copy, and then runs the named test file.

Windows (PowerShell):

```powershell
docker run --rm -v "${PWD}:/src:ro" node:22.23.4-trixie-slim@sha256:be1e2a3dc2c4fd68cdfadad2a696a280e0d2749098bee509230174d72fb768c6 sh -c 'set -e; apt-get update -qq; apt-get install -y -qq --no-install-recommends git jq bash ca-certificates >/dev/null; mkdir /work; cd /src; tar --exclude=node_modules -cf - . | (cd /work && tar -xf -); cd /work; npm install -g pnpm@12.15.0 >/dev/null; pnpm install --frozen-lockfile; pnpm vitest run launcher/test/hostile/statedir.bash.test.ts'
```

macOS (bash):

```sh
docker run --rm -v "$(pwd):/src:ro" node:22.23.4-trixie-slim@sha256:be1e2a3dc2c4fd68cdfadad2a696a280e0d2749098bee509230174d72fb768c6 sh -c 'set -e; apt-get update -qq; apt-get install -y -qq --no-install-recommends git jq bash ca-certificates >/dev/null; mkdir /work; cd /src; tar --exclude=node_modules -cf - . | (cd /work && tar -xf -); cd /work; npm install -g pnpm@12.15.0 >/dev/null; pnpm install --frozen-lockfile; pnpm vitest run launcher/test/hostile/statedir.bash.test.ts'
```

To run another file from the list, replace the path after `pnpm vitest run`. To run several, list them all after it. The container needs network access for `apt-get` and `npm`.
