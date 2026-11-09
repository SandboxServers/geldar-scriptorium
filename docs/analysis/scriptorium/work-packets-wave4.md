# Scriptorium work packets: wave 4 (the kit image)

Part of [work-packets.md](work-packets.md): its dispatch rules 1-15 and its Contract apply to every packet here. Ledger: [README.md](README.md). This wave lives in its own file because `work-packets.md` is past its size cap.

## Wave 4 — the kit image (ships as one PR from `scriptorium/wave4`)

Order: **SC-40a** first (it owns `tests/image/docker.ts`). Then **SC-40b and SC-41a** in parallel from the wave branch (no shared files). Then **SC-41b, SC-42a and SC-42b** in parallel after SC-40b (SC-41b also needs SC-41a). Packets touching `.github/workflows/ci.yml` or `pnpm-lock.yaml`: only SC-40b (rule 13). Nothing here touches `template/`, so dispatch rule 7 does not apply. No image is pushed anywhere before SC-63.

Dispatch notes:
- Every brief names the worktree, the report path and the commit message below. Tell Haiku coders: write the stub report first, commit as soon as the checks pass (rule 12).
- All image tests need Linux containers. `docker info --format '{{.OSType}}'` must print `linux`; if not, the suite skips locally and **must run in CI** (rule 14); open a draft PR early and read the CI log to confirm the suites ran, not skipped. In CI (`CI=true`) a missing Docker is a failure, never a skip.
- Timeouts are mandatory in every `tests/image` file: `beforeAll(buildKit, 900_000)`, every `it` 120_000, `run(...)` timeoutMs 60000, or 90000 in `cli.test.ts` (see Timeouts in the shared shape). Vitest's 5 s default fails every case.
- Files that Squid reads (any temp file or directory mounted into the proxy) must be `chmodSync(file, 0o644)` and directories `0o755` in the test helper: on a Linux runner `mkdtemp` makes 0700 and files 0600 owned by uid 1001, and Squid under `cap_drop: [ALL]` cannot read them. The proxy needs no `DAC_OVERRIDE` with these modes. On Windows `chmod` is a no-op, so the 0644 rule is proven only in CI (the draft-PR early run covers it).
- Run only your own tests while iterating: `./scriptorium.ps1 pnpm vitest run tests/image/<file>`. The image build takes about two minutes cold; layers cache after that.

### Wave 4 shared shape (read first)

**Pins (verified 2026-11-08 on the author machine, Docker 29.1.3, Linux containers):**

| Thing | Pin | How verified |
|---|---|---|
| Base image | `node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6` | `docker buildx imagetools inspect node:22.23.2-trixie-slim` (an index digest, multi-arch). Node 22.23.2 matches `.nvmrc`. Debian 13 (trixie), chosen because bookworm's git is **2.39.5**, too old |
| git in that base | Debian `git` **2.47.3** (apt, unpinned; any trixie build is at least 2.47) | `docker run ... git --version` in the built image. The Dockerfile build fails if `git` is older than 2.40 (a `RUN` check, step 3 below) |
| Claude Code CLI | `@anthropic-ai/claude-code@2.1.310`, published 2026-10-23T21:20:46Z (16 days old on 2026-11-08) | `npm view @anthropic-ai/claude-code time`; also `claude --version` prints `2.1.310 (Claude Code)` in the built image. npm `stable` is 2.1.311 (2026-10-26, 13 days old: too new), `latest` 2.1.319. The floor is 2.1.257. Fallback if 2.1.310 is ever yanked: 2.1.309 (2026-10-22) |
| pnpm (build stage only) | `pnpm@12.15.0` | the repo's `packageManager`; `pnpm install --frozen-lockfile --prod --filter "./packages/{path-rule,memory,git,verify}"` works with the other packages absent from the build context |
| Squid | `ubuntu/squid@sha256:6a097f68bae708cedbabd6188d68c7e2e7a38cedd05a176e1cc0ba29e3bbe029` (Squid 6.13, image created 2025-11-24) | `docker buildx imagetools inspect ubuntu/squid:latest`, then `squid -v` in the pulled digest. The multi-arch index digest |

The Dockerfile and compose files carry each pin as `image:tag@sha256:digest` with the tag kept, so Dependabot and humans can read it (rule 4).

**Facts established by running the pinned CLI in a scratch image (the packets rely on them):**
- **Managed settings path on Linux is `/etc/claude-code/managed-settings.json`** (also `/etc/claude-code/managed-settings.d/`). Verified without a login: a file there containing `{"model": 5}` makes `claude -p hi` and `claude doctor` print `/etc/claude-code/managed-settings.json (model): Failed schema validation. This field was ignored.`; a valid file prints nothing.
- **Tool denies are visible without a login or a model.** With a fake `ANTHROPIC_API_KEY`, `claude -p hi --output-format stream-json --verbose` prints a first line `{"type":"system","subtype":"init","tools":[...],"mcp_servers":[...]}` before the API call fails with 401. With the shipped `managed.json` the `tools` list has no `Bash`, `WebFetch` or `WebSearch`, and has `Read`, `Edit`, `Write`.
- **`/permissions` does not run non-interactively** (`claude -p "/permissions"` answers "isn't available in this environment"). Path denies (`Read(//cli-home/**)` and so on) therefore cannot be exercised without a model. This wave tests them structurally and records the live test as an open item (below).
- **The pinned CLI passes its whole environment to stdio MCP servers**, including `GELDAR_MODE` and `CLAUDE_CONFIG_DIR`. A probe server (`sh -c 'env > /tmp/envdump'`) saw `GELDAR_MODE=setup`. The real `geldar-memory` and `geldar-git mcp` start under it with status `connected`.
- **Path rule syntax** (code.claude.com/docs/en/permissions, fetched 2026-11-08): a single leading `/` anchors at the *settings source*, `//path` is an absolute filesystem path, `~/` is home. So the CLI home (mounted at `/cli-home`) is denied as `//cli-home/**`.
- `claude doctor` shows "Auto-updates: enabled" by default; the image sets `DISABLE_AUTOUPDATER=1` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`.
- Hosts the CLI binary names: `api.anthropic.com`, `claude.ai`, `platform.claude.com` (plus docs, status, downloads and MCP-proxy hosts that the session must **not** need).

**Image contract (what SC-50, the launcher, relies on):**

| Item | Value |
|---|---|
| User | `player`, uid/gid 1000 by default (the node image's `node` user, renamed). The launcher runs the container with `--user <host uid>:<host gid>` and `HOME=/tmp`, so the process uid equals the workspace owner's (git's `safe.directory` check cannot be relaxed from `-c` or a nulled global config) |
| Workdir | `/player` (the workspace mount) |
| CLI home | `/cli-home` (`CLAUDE_CONFIG_DIR`), a per-player, per-vendor volume mounted by the launcher |
| Marker | `/etc/geldar-kit`, root-owned, mode 0444 |
| Settings | `/etc/geldar/settings/play.json` and `setup.json`; managed settings at `/etc/claude-code/managed-settings.json` (all root-owned, files 0444, directories 0555) |
| Binaries | `claude` (the real CLI), `geldar-memory`, `geldar-git`, `geldar-verify` in `/usr/local/bin`. **Never** `stub-cli` (its bin is also named `claude`) |
| Code | `/opt/geldar` (workspace copy with production dependencies; the wrappers run `node /opt/geldar/packages/<p>/src/cli.ts`, which works because Node 22.23 strips types and the files are not under a `node_modules` path) |
| Build target | `--target kit` (the last production stage); the `nettest` stage is for tests only and is never released |

**Test support** (`tests/image/docker.ts`, created by SC-40a): see SC-40a step 3. All image tests import it and use `describe.skipIf(!ready)`.

**Timeouts (every packet with image tests):** Vitest's default is 5 s, so every `it` and every `beforeAll`/`afterAll` in `tests/image` takes an explicit timeout as its last argument: `it` 120_000; `beforeAll(buildKit)` 900_000; compose `up` 300_000; `afterAll` (compose `down`) 120_000. The `run(...)` timeout is separate (the `spawnSync` limit). Vitest runs the test files in parallel workers and each calls `buildKit()` (the once-flag is per process), so concurrent `docker build` of one tag happens; BuildKit tolerates it, and the 900 s hook budget must cover a cold build under that contention (the CI job timeout of 25 min is enough).

**Open items needing the orchestrator or the owner (do not decide in a packet):**
1. **Path-deny behavior needs a model.** Whether `Read(//cli-home/**)`, `Edit`/`Write` of the same, and play.json's identity denies actually bite can only be shown with a live model call (`/permissions` is interactive-only). D-SC-01 is settled: no API key in CI, so this is an owner-run local check (SC-62); until then SC-40a/SC-42b test structure and CLI acceptance, and H-20's "tested" is partial. SC-62 should carry the live case.
2. **`--settings` path anchoring.** `play.json` uses `Edit(/memory/identity.md)`. The docs say a single `/` anchors at the *settings source*; for a `--settings` file that may not be the project root. SC-40a therefore adds the absolute `//player/memory/identity.md` twins (belt and braces); the orchestrator should confirm in the live job.
3. **D-SC-04 wording "no DNS".** Docker's embedded resolver cannot be removed from a user-defined network; on an `internal` network it answers only the compose service names and returns SERVFAIL for everything else (verified). The packets implement and test "no DNS for external names". Owner to accept that reading.
4. **D-SC-06 (GHCR visibility)** is not needed by this wave (nothing is pushed); only noting that SC-63 will.
5. **Allowlist vendor hosts** (`api.anthropic.com`, `claude.ai`, `platform.claude.com`) come from strings in the binary, not from a live login; the live job (SC-62) confirms the set is enough and no more.
6. **Squid image provenance.** `ubuntu/squid` is Canonical's Docker Hub image. The alternative is a small Dockerfile on the pinned Debian base running `apt install squid`; the orchestrator may prefer that for SC-63's SBOM and scan.
7. **Windows bind mounts.** Docker Desktop reports bind-mounted files with uids that do not follow the host, so the uid-match test (SC-42a case 8) runs only on Linux; the Windows launcher (SC-53) must be tested for the same-uid rule separately.
8. **Follow-ups for SC-60 and SC-63 (recorded, not built here).** The session service has no `read_only: true` root and no `pids_limit`. Squid has no source-address ACL (any container on `outside` can use the proxy, still limited to the two allowlists). `dstdomain` allows any address an allowed name resolves to (fine for owner-controlled names). The `/cli-home` volume is read-write by design and its denies are structural only (open item 1).

---

### SC-40a — Settings and the Docker test support

- **Branch** `scriptorium/sc-40a-settings`, worktree `sc-40a`. Commit: `feat(image): deny the CLI home in managed settings, add Docker test support`. Repo S. Depends on: wave 2.
- **Files (4):** `image/settings/managed.json` (change), `image/settings/play.json` (change), `tests/image/docker.ts` (new), `tests/image/settings.test.ts` (new).
- **Step 1, `managed.json`.** Keep every existing key. In `permissions.deny`, after the `**/.credentials.json` rules, add exactly these six:
  `"Read(//cli-home/**)"`, `"Edit(//cli-home/**)"`, `"Write(//cli-home/**)"`, `"Read(//cli-home)"`, `"Edit(//cli-home)"`, `"Write(//cli-home)"`. (`/cli-home` is the image's `CLAUDE_CONFIG_DIR`; `//` makes it an absolute path.)
- **Step 2, `play.json`.** Keep the two existing rules and add `"Edit(//player/memory/identity.md)"` and `"Write(//player/memory/identity.md)"` (workdir `/player`). Do not touch `setup.json`.
- **Step 3, `tests/image/docker.ts`.** Exports, with one-line comments:
  - `KIT_IMAGE`: `process.env.KIT_IMAGE ?? 'geldar-kit:test'`.
  - `SQUID_IMAGE`: the string `ubuntu/squid@sha256:6a097f68bae708cedbabd6188d68c7e2e7a38cedd05a176e1cc0ba29e3bbe029` (the one Squid pin; SC-41a and SC-41b import it from here, never from a test file).
  - `repoRoot`: absolute path of the repo root, from `import.meta.url`.
  - `dockerReady(): boolean`: true when `docker info --format {{.OSType}}` prints `linux`. If false and `process.env.CI === 'true'`, throw an Error naming Docker; if false locally, `console.warn` once and return false.
  - `buildKit(): void`: runs `docker build --target kit -f image/Dockerfile -t KIT_IMAGE .` with cwd `repoRoot`, once per process (module flag), throwing with stderr on failure. (Used from SC-40b on; here it is only defined.)
  - `run(args: string[], opts?: { input?: string; timeoutMs?: number }): { status: number; stdout: string; stderr: string }`: `spawnSync('docker', args, { encoding: 'utf8', input: opts?.input, timeout: opts?.timeoutMs ?? 120000 })`; a null status becomes 124 (timeout).
  - `dockerPath(p: string): string`: the path as Docker wants it for `-v` (on Windows keep the native `C:\...` form; no change needed, but the function exists so tests have one place to adjust).
  Under 80 lines. No other exports besides these.
- **Step 4, `tests/image/settings.test.ts`** (reads the two JSON files with `readFileSync`; needs no Docker). Cases:
  1. managed denies `Read`, `Edit` and `Write` of `//cli-home/**` and of `//cli-home` (six rules present).
  2. managed still denies `Bash`, `WebFetch`, `WebSearch` and the three `**/.credentials.json` rules.
  3. play.json denies `Edit` and `Write` of both `/memory/identity.md` and `//player/memory/identity.md`.
  4. no rule in managed or play contains `allow`-style widening: `permissions.allow` is absent from both.
  5. every deny rule in managed, play and setup is a string that is either a bare tool name or `Tool(pattern)` (regex `^[A-Za-z_*]+(\(.+\))?$`), so a typo like `Read //x` fails.
  6. `SQUID_IMAGE` (imported from `./docker.ts`) matches `^ubuntu/squid(:[^@]+)?@sha256:[0-9a-f]{64}$`.
- **Revert check (rule 9, name it in the report):** remove `"Write(//cli-home/**)"` from managed.json: case 1 fails. Remove the `//player/...` twins from play.json: case 3 fails. Change `SQUID_IMAGE` to a string without a digest: case 6 fails. Restore all.
- **Checks:** `./scriptorium.ps1 pnpm vitest run tests/image`, then `./scriptorium.ps1 check`. `tests/template/settings.test.ts` must still pass unchanged.

### SC-40b — The Dockerfile and its build test

- **Branch** `scriptorium/sc-40b-dockerfile`, worktree `sc-40b`. Commit: `feat(image): the kit image Dockerfile, pinned CLI and companions`. Depends on: SC-40a.
- **Files (4):** `image/Dockerfile` (new), `.dockerignore` (new), `tests/image/build.test.ts` (new), `.github/workflows/ci.yml` (change).
- **Step 1, `.dockerignore`:** an allowlist. First line `*`, then `!package.json`, `!pnpm-lock.yaml`, `!pnpm-workspace.yaml`, `!.nvmrc`, `!packages/path-rule`, `!packages/memory`, `!packages/git`, `!packages/verify`, `!image/settings`, then `**/node_modules`, `**/*.test.ts` and `**/test-client.ts` (only memory's tests import it). `stub-cli` must be absent from the context.
- **Step 2, `image/Dockerfile`:** two stages (`deps`, `kit`) and a third, `nettest`, below. Use these exact lines (base pin from the shared shape):

  ```
  # syntax=docker/dockerfile:1
  FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS deps
  RUN npm install -g pnpm@12.15.0
  WORKDIR /opt/geldar
  COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
  COPY packages ./packages
  RUN pnpm install --frozen-lockfile --prod --filter "./packages/{path-rule,memory,git,verify}"

  FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS kit
  ARG CLAUDE_CODE_VERSION=2.1.310
  RUN apt-get update \
   && apt-get install -y --no-install-recommends git jq bash ca-certificates \
   && rm -rf /var/lib/apt/lists/* \
   && git --version | awk '{split($3,v,"."); exit !(v[1]>2 || (v[1]==2 && v[2]>=40))}' \
   && npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
   && groupmod -n player node && usermod -l player -d /home/player -m node
  COPY --from=deps /opt/geldar /opt/geldar
  RUN for b in memory git verify; do \
        printf '#!/bin/sh\nexec node /opt/geldar/packages/%s/src/cli.ts "$@"\n' "$b" > /usr/local/bin/geldar-$b; \
        chmod 0755 /usr/local/bin/geldar-$b; done
  COPY image/settings/managed.json /etc/claude-code/managed-settings.json
  COPY image/settings/play.json image/settings/setup.json /etc/geldar/settings/
  RUN printf 'geldar kit\n' > /etc/geldar-kit \
   && find /etc/geldar /etc/claude-code -type f -exec chmod 0444 {} + \
   && find /etc/geldar /etc/claude-code -type d -exec chmod 0555 {} + \
   && chmod 0444 /etc/geldar-kit \
   && mkdir -p /player /cli-home && chown player:player /player /cli-home
  ENV CLAUDE_CONFIG_DIR=/cli-home DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
  USER player
  WORKDIR /player

  FROM kit AS nettest
  USER root
  RUN apt-get update && apt-get install -y --no-install-recommends curl bind9-dnsutils \
   && rm -rf /var/lib/apt/lists/*
  USER player
  ```

  Keep the stage order (the default target must not be `nettest`; builds always pass `--target`). Add header comments: what the image is for; that the pins are exact; the git-version floor; that `nettest` is test-only.
- **Step 3, `tests/image/build.test.ts`.** `const ready = dockerReady()`; `beforeAll(buildKit, 900_000)`; every `it` takes 120_000 (see Timeouts in the shared shape). Cases (each `run(['run','--rm',KIT_IMAGE,'sh','-c',...], { timeoutMs: 60000 })`):
  1. `claude --version` starts with the version in the Dockerfile's `ARG CLAUDE_CODE_VERSION=` line (read the Dockerfile with a regex, so one edit moves both).
  2. the Dockerfile text contains `@sha256:` on every `FROM` line (regex over the lines), and no `:latest`.
  3. `git --version` is 2.40 or newer (parse; compare numerically).
  4. `id -un` is `player` and `pwd` is `/player` with no `--user`.
  5. `/usr/local/bin/claude` resolves (`readlink -f`) to a path containing `claude-code`, and `ls /opt/geldar/packages` shows `git memory path-rule verify` and **not** `stub-cli`.
  6. the three companions run: `geldar-verify` with no arguments exits 2; `geldar-memory --root /player </dev/null` exits 0; `geldar-git` with no arguments exits non-zero with a usage line.
  7. `node -v` minus the leading `v` equals the trimmed content of `.nvmrc` (`22.23.2`, no `v` in the file).
  8. `DISABLE_AUTOUPDATER` is `1` in `env`.
- **Step 4, `ci.yml`:** in the `typescript` job add a step before `test (vitest)`: `name: docker is available (image tests need it)`, `run: docker version --format '{{.Server.Os}} {{.Server.Version}}'`. Change `timeout-minutes` to `25`. Change nothing else; do not add a push step.
- **Revert checks:** change the base `FROM` in `kit` to the bookworm tag: case 3 fails (git 2.39) and the `RUN` version check breaks the build. Change `CLAUDE_CODE_VERSION` in the Dockerfile only: case 1 stays green (it reads the same line), so instead edit the `npm install` to a different literal version: case 1 fails. Delete `USER player`: case 4 fails. Remove `!packages/verify` from `.dockerignore`: the build fails. Restore all.
- **Checks:** `./scriptorium.ps1 pnpm vitest run tests/image/build.test.ts`, `./scriptorium.ps1 check`. Report the cold build time and the image size (`docker image ls`).

### SC-41a — The Squid proxy and its allowlist

- **Branch** `scriptorium/sc-41a-proxy`, worktree `sc-41a`. Commit: `feat(image): egress proxy config with a hostname allowlist`. Depends on: SC-40a (imports its `tests/image/docker.ts`).
- **Files (4):** `image/proxy/squid.conf`, `image/proxy/allowlist-vendor.txt`, `image/proxy/README.md`, `tests/image/proxy-config.test.ts`.
- **`squid.conf`** (exactly):

  ```
  # Egress allowlist proxy for the session container (D-SC-04).
  http_port 3128
  acl SSL_ports port 443
  acl Safe_ports port 80
  acl Safe_ports port 443
  acl CONNECT method CONNECT
  acl allowed_vendor dstdomain "/etc/squid/allowlist-vendor.txt"
  acl allowed_world dstdomain "/etc/squid/allowlist-world.txt"
  http_access deny !Safe_ports
  http_access deny CONNECT !SSL_ports
  http_access allow allowed_vendor
  http_access allow allowed_world
  http_access deny all
  cache deny all
  via off
  forwarded_for delete
  pid_filename none
  ```
  (No `access_log stdio:/dev/stdout`: Squid's `proxy` user cannot open it and exits. Default logging to `/var/log/squid/access.log` is kept.)
- **`allowlist-vendor.txt`:** a comment line, then `api.anthropic.com`, `claude.ai`, `platform.claude.com`, one per line (exact hosts; no leading dot, so no subdomains). The world allowlist (`allowlist-world.txt`: the MCP host from `player.json`) is **not** committed; the launcher writes it per session (SC-50) and compose mounts it.
- **`README.md`** (developer doc, under 40 lines): the two allowlists, why `deny all` is last, the port limits, how to add a host (PR + a test line), and that Squid resolves names so the session container needs no DNS.
- **Tests (`proxy-config.test.ts`)**, structure plus Squid's own parser (`docker run --rm -v <conf>:/etc/squid/squid.conf:ro -v <vendor>:/etc/squid/allowlist-vendor.txt:ro -v <empty temp file, chmod 0644 and its directory 0755>:/etc/squid/allowlist-world.txt:ro --entrypoint squid SQUID_IMAGE -k parse`):
  1. `squid -k parse` (image reference: `SQUID_IMAGE` imported from `./docker.ts`) exits 0 for the shipped config (skipped without Docker); every `it` takes the explicit timeout from the shared shape.
  2. the last `http_access` line is `http_access deny all`, and no `http_access allow` line appears after a `deny all`.
  3. there is no `http_access allow all` and no `allow localnet`/`allow localhost` line anywhere.
  4. `allowlist-vendor.txt` has no wildcard-leading entry (no line starting with `.` or `*`), no IP-literal entry (regex `^\d+\.\d+\.\d+\.\d+$` fails every line), and contains `api.anthropic.com`.
  5. `SQUID_IMAGE` (from `./docker.ts`; this file exports nothing) matches `^ubuntu/squid(:[^@]+)?@sha256:[0-9a-f]{64}$`. The link to `session.yml` is SC-41b's case 10.
  6. a config with `http_access allow all` appended before `deny all` fails case 2's rule: write that variant to a temp string and assert the same checker function rejects it (the checker is a local function so the test can test itself).
- **Revert checks:** change `deny all` to `allow all` in `squid.conf`: cases 2 and 3 fail. Add `.anthropic.com` to the vendor list: case 4 fails. Break the config syntax (`acl` typo): case 1 fails. Restore.
- **Checks:** `./scriptorium.ps1 pnpm vitest run tests/image/proxy-config.test.ts`, `./scriptorium.ps1 check`.

### SC-41b — Session networking and the egress tests

- **Branch** `scriptorium/sc-41b-egress`, worktree `sc-41b`. Commit: `feat(image): internal session network behind the proxy, with allow and deny tests`. Depends on: SC-40b, SC-41a.
- **Files (4):** `image/compose/session.yml`, `image/compose/session.test.yml`, `tests/image/fixtures/allowlist-world.txt`, `tests/image/egress.test.ts`.
- **`session.yml`** (no IP addresses anywhere; names only):
  - `proxy`: `image:` is the exact `SQUID_IMAGE` string from `tests/image/docker.ts`, written literally (case 10 compares it), volumes `../proxy/squid.conf:/etc/squid/squid.conf:ro`, `../proxy/allowlist-vendor.txt:/etc/squid/allowlist-vendor.txt:ro`, `${GELDAR_WORLD_ALLOWLIST:?}:/etc/squid/allowlist-world.txt:ro`; networks `inside` and `outside`; `cap_drop: [ALL]` plus `cap_add: [SETUID, SETGID]` (measured: Squid aborts with `setgid: Operation not permitted` without them, so they are always required; CHOWN and DAC_OVERRIDE are not needed). Every mounted file must be 0644 and directory 0755. Do not add `DAC_OVERRIDE`: it would hide a bad file mode.
  - `session`: image `${KIT_IMAGE:?}`, `user: "${GELDAR_UID:?}:${GELDAR_GID:?}"`, `working_dir: /player`, volumes `${GELDAR_WORKSPACE:?}:/player` and `${GELDAR_CLI_HOME:?}:/cli-home`, environment `HOME: /tmp`, `HTTP_PROXY`/`HTTPS_PROXY`/`http_proxy`/`https_proxy`: `http://proxy:3128`, `NO_PROXY: ""`, `GELDAR_MODE: ${GELDAR_MODE:-play}`; network `inside` only; `cap_drop: [ALL]`; `security_opt: [no-new-privileges:true]`; `depends_on: [proxy]`; `tty`/`stdin_open: true`.
  - networks: `inside: { internal: true }`, `outside: {}`.
  - Lowercase `http_proxy` matters: curl ignores uppercase `HTTP_PROXY`.
- **`session.test.yml`** (overlay, test only): service `world` from `${KIT_IMAGE}` with `user: root`, command `node -e "require('http').createServer((q,r)=>r.end('world ok')).listen(80)"`, on `outside` with alias `world.test`; and `session` overridden with `image: ${NETTEST_IMAGE:?}` and `command: ["sleep","600"]`. The test still exports `KIT_IMAGE` too, because `session.yml` requires it.
- **`fixtures/allowlist-world.txt`:** the single line `world.test`.
- **`egress.test.ts`:** build both targets (`docker build --target nettest -t geldar-kit-nettest:test` after `buildKit()`), with `beforeAll` 900_000 for the builds and 300_000 for `up`, `it` 120_000, `afterAll` 120_000 (see Timeouts), then `docker compose -p geldar-egress-<pid> -f session.yml -f session.test.yml up -d --wait`, with the env vars set to temp directories and `process.getuid?.() ?? 1000`; `afterAll` runs `down -v`. Exec helper `inSession(cmd)`. Cases (all inside the session container):
  1. **allowed host works:** `curl -sS -m 10 http://world.test/` prints `world ok`, exit 0.
  2. **`github.com` fails through the proxy:** `curl -sS -m 10 -o /dev/null -w '%{http_code}' http://github.com/` prints `403`; `https://github.com/` fails with `CONNECT tunnel failed, response 403`.
  3. **raw IP fails:** read the world container's own address at runtime (`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' <world>`; keep only the first token, never write it to a file) and request `http://<that>/` through the proxy: `403`. If the status is not 403, report it; do not weaken the assertion.
  4. **direct (proxy variables removed) fails:** `env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY curl --noproxy '*' -sS -m 6 http://world.test/` exits non-zero (could not resolve), and so does `curl --noproxy '*' -sS -m 6 https://example.com/` (a name that resolves from a non-internal network, so it fails only because `inside` is `internal: true`).
  5. **`nslookup github.com` fails:** non-zero exit, output contains `SERVFAIL` or `can't find` and no `Address:` answer line after the server block.
  6. **`nslookup world.test` also fails** (the session cannot resolve the egress side's names; only Squid can).
  7. **a non-standard port to an allowed host is refused:** `curl http://world.test:8080/` prints `403` (`Safe_ports`).
  8. **the allowlist changes the answer:** (chmod the empty file 0644 and its directory 0755 first) with `fixtures/allowlist-world.txt` replaced by an empty file (use a second compose project with the empty file; do not reconfigure the running one), case 1 now returns `403`. This proves the allow comes from the allowlist, not from the network shape.
  9. **the session runs unprivileged:** `id -u` equals `GELDAR_UID`; `cat /proc/self/status` shows `CapBnd: 0000000000000000` (what `cap_drop: [ALL]` changes; a non-root user has `CapEff` 0 regardless) and also `CapEff: 0000000000000000`.
  10. **`session.yml` uses the pinned Squid:** its text contains the exact `SQUID_IMAGE` string (import it from `./docker.ts`).
- **Revert checks:** remove `internal: true` from `inside`: cases 4 and 5 fail (case 4 through the `example.com` request). Change the squid `deny all`: cases 2 and 3 fail. Drop the `http_proxy` lowercase variables: case 1 fails. Remove `cap_drop` from `session`: case 9 fails (`CapBnd`). Change the digest in `session.yml`: case 10 fails.
- **Checks:** `./scriptorium.ps1 pnpm vitest run tests/image/egress.test.ts`, `./scriptorium.ps1 check`. Report compose startup time and the capabilities Squid needed.
- **Size note:** this is the largest packet. Budget one retry; if the coder is still stuck after it, the orchestrator splits it: compose files and cases 1-4 first, cases 5-10 as a follow-up.

### SC-42a — Image contract tests

- **Branch** `scriptorium/sc-42a-contract`, worktree `sc-42a`. Commit: `test(image): marker, hooks guard, read-only kit paths, uid and git`. Depends on: SC-40b.
- **Files (1):** `tests/image/contract.test.ts`. (No changes to the Dockerfile; a failing case means a bug for the orchestrator to route to SC-40b's owner, reported in your report.)
- Setup: `dockerReady()`, `beforeAll(buildKit, 900_000)`; every `it` takes 120_000; each `run(...)` timeoutMs 60000 (see Timeouts in the shared shape). A temp workspace helper made inside the test file: `mkdtemp`, `git init -q -b main`, a minimal `player.json` and `memory/identity.md`, one commit with `-c user.name=Host -c user.email=host@example.test`.
- Cases:
  1. **marker:** `/etc/geldar-kit` exists, is owned by root and is not writable by `player` (`test ! -w`).
  2. **settings in place and unwritable:** `/etc/geldar/settings/play.json`, `setup.json` and `/etc/claude-code/managed-settings.json` equal the repo's files byte for byte (`docker run ... cat` compared with `readFileSync`), and `test ! -w` holds for each and for their directories.
  3. **hooks act only with the marker:** mount `template/.claude/hooks` read-only at `/hooks` and the temp workspace at `/player`, and run every workspace-mounting case with `--user <uid>:<gid> -e HOME=/tmp` (your uid on Linux; on Windows use the default and skip the git assertions). Execute the hooks as `bash /hooks/session-start.sh` so a lost exec bit on a Windows mount cannot fail the case. With the marker present, `CLAUDE_PROJECT_DIR=/player bash /hooks/session-start.sh` prints text starting `You are `. With `-e GELDAR_KIT_MARKER=/nonexistent`, it prints nothing and exits 0. The same pair for `post-tool-use.sh` (stdin `{"tool_name":"mcp__geldar__say","tool_input":{"text":"hi"}}`): with the marker it exits 0 and `memory/journal/current.md` exists in the workspace and contains `say`; without it, stdout and stderr are empty, `memory/journal/current.md` does not exist, and `git status --porcelain` exits 0 with empty output (assert the exit status, so a failing git cannot pass as empty).
  4. **hooks never run as root:** in the case 3 invocation the hook run is started with `--user <uid>:<gid>` and `id -u` printed in the same shell equals that uid and is non-zero. On Windows (no `--user` uid) run with `--user 1000:1000`.
  5. **harness smoke check (not an image test):** with the workspace mounted and `--user` your uid on Linux, `echo x >> /player/memory/identity.md` succeeds, so the workspace is writable for the process uid. The real read-only overlay of kit paths belongs to SC-50 and SC-60, not here; do not test a `:ro` mount (it only tests Docker).
  6. **the player cannot become root:** `sudo` does not exist, `su` fails, and the image default user is not root (`id -u` is non-zero with no `--user`).
  7. **no secrets baked in:** `env` in the image contains none of `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GH_TOKEN`, `AWS_`, `AZURE_`; `ls -A /cli-home` is empty; `ls -A /home/player` shows no `.gitconfig`, `.ssh` or `.claude`.
  8. **same uid as the workspace owner (Linux only, `describe.skipIf(process.platform !== 'linux')`):** run `git -C /player status --porcelain` with `--user <your uid>:<your gid>` and `-e HOME=/tmp`: exit 0. With `--user <uid+1>:<gid+1>`: non-zero and stderr contains `dubious ownership`. (This documents why the launcher must pass its own uid.)
  9. **geldar-git works in the image at the workspace uid** (Linux only): a one-file change under `memory/` is committed by `geldar-git commit --root /player --message "test"` run as your uid; `git log -1 --format=%an` is the player's noreply name from `player.json` (copy the expectation from `packages/git/src/commit.test.ts`).
- **Revert checks (name them):** delete the `printf ... > /etc/geldar-kit` line locally: case 1 fails and case 3's first half fails. Change the marker default in `session-start.sh` in a temp copy and mount that: case 3's first half fails. Delete the guard line in a temp copy of `post-tool-use.sh` and mount it: case 3's second half fails. Add `sudo` to a temp image build: case 6 fails. Run the hooks without `--user` as root (`--user 0`): case 4 fails. Add a `/cli-home/x` file in a temp image: case 7 fails. Run case 8's second run as the same uid: it must pass `git status`, so the case fails (proves the check is live). Restore.
- **Checks:** `./scriptorium.ps1 pnpm vitest run tests/image/contract.test.ts`, `./scriptorium.ps1 check`.

### SC-42b — Pinned CLI behavior tests (no login, no model)

- **Branch** `scriptorium/sc-42b-cli`, worktree `sc-42b`. Commit: `test(image): managed settings path, tool denies and GELDAR_MODE under the pinned CLI`. Depends on: SC-40a, SC-40b.
- **Files (1):** `tests/image/cli.test.ts`. Same rule as SC-42a for failing cases.
- Common: run with `-e HOME=/tmp -e CLAUDE_CONFIG_DIR=/tmp/cfg -e ANTHROPIC_API_KEY=sk-ant-fake` (a fake key: the CLI contacts api.anthropic.com once and gets a 401; D-SC-01 holds, there is no secret and no model call. Never pass `-e ANTHROPIC_API_KEY` without a value: docker would forward a real key from the environment). Helper `initLine(extraArgs, extraDockerArgs)` runs `claude -p hi --output-format stream-json --verbose --max-turns 1 ...` in a temp workspace mounted at `/player` using `spawn` with `docker run --rm --name <unique>`, reads stdout until the first line arrives, then runs `docker kill <name>` and returns `JSON.parse` of that line; a timeout or non-zero exit after the line was captured must not fail the case, and cases 3-7 must not depend on the 401 timing. (Without a network the CLI retries for minutes, so never wait for it to exit.) Where `claude doctor` or the dump is needed, bound it with `timeout 60` inside the container (`type: "system"`, `subtype: "init"`). Init takes about 30 s here (with or without `--network none`; the 401 path in CI is similar), so keep the 90 s limit and the 120_000 `it`; do not shorten them. Case 6 asserts `connected` in the init line: if the real companions do not report it, report the mismatch, do not weaken the assertion. Each `it` takes 120_000 and each `run(...)` timeoutMs 90000 (see Timeouts in the shared shape).
- Cases:
  1. **managed path:** mount a temp file containing `{"model": 5}` at `/etc/claude-code/managed-settings.json:ro` (overriding the image's) and run `claude doctor`: output contains `- /etc/claude-code/managed-settings.json › model: Failed schema validation. This field was ignored.`. Proves the CLI reads that exact path.
  2. **shipped managed settings are valid for the pinned CLI:** `claude doctor` in the plain image prints no `Invalid settings` and no `Managed settings contain invalid entries`.
  3. **tool denies:** the init `tools` array has none of `Bash`, `WebFetch`, `WebSearch`, and does have `Read`, `Edit`, `Write`.
  4. **the denies come from the managed layer, not the test:** run once more with `-v <temp empty json {}>:/etc/claude-code/managed-settings.json:ro`; now `tools` contains `Bash` (so case 3 is not vacuous).
  5. **play and setup files are accepted by the CLI:** `claude -p hi --settings /etc/geldar/settings/play.json ...` and `.../setup.json` each print an init line (no "invalid" text on stderr), and `tools` still lacks `Bash`. (Layers merge; managed wins.)
  6. **the real companions start under the CLI:** `--mcp-config` with `geldar_memory` (`geldar-memory --root /player`) and `geldar_git` (`geldar-git mcp --root /player`) entries, plus `--strict-mcp-config`; the init `mcp_servers` shows both `connected`, and `tools` includes `mcp__geldar_memory__recall` and `mcp__geldar_git__commit_memory`. The workspace must contain `player.json` (`{}` is enough) and a `memory/` directory.
  7. **`GELDAR_MODE` reaches the MCP servers (D-SC-14):** a probe server entry `{"command":"sh","args":["-c","env > /tmp/envdump; sleep 5"]}`; with `-e GELDAR_MODE=setup` the dump is read while the container is alive: mount a temp dir (chmod 0777) at `/tmp/probe`, have the probe write `env > /tmp/probe/envdump`, and read the file on the host after the init line and `docker kill` (or run without `--rm` and `docker exec <name> cat /tmp/envdump` before the kill). With `-e GELDAR_MODE=setup` it contains `GELDAR_MODE=setup`; with the variable unset, assert the file exists (the probe really ran) and contains no `GELDAR_MODE=`. Never wait for the CLI to exit. (The probe's status is `failed` because it is not an MCP server; ignore it.)
  8. **setup mode lets the identity commit through; play and unset refuse (D-SC-14, end to end in the image):** a temp repo, built as in SC-42a, with `memory/identity.md` committed, then modified in the working tree. Run `geldar-git commit --root /player --message "identity"`: with `-e GELDAR_MODE=setup` it exits 0 and `git show --stat HEAD` lists `memory/identity.md`; with `-e GELDAR_MODE=play` and with nothing set, it exits non-zero, stderr is non-empty, and `git rev-parse HEAD` is unchanged. Use `--user` your uid on Linux (skip this case on Windows; it runs in CI).
- **Note (not a case):** setup mode only for an unborn player is the launcher's rule, not the image's; there is no test here and the report says so (SC-52 covers it). Do not add one.
- **Revert checks:** remove `Bash` from `managed.json`'s deny list: case 3 fails. Mount the settings at `/etc/claude/managed-settings.json` in case 1's expectation instead of `/etc/claude-code/`: it fails. In `packages/git/src/cli.ts` ignoring `process.env.GELDAR_MODE` (local, restore after): case 8's setup run fails. Drop `-e GELDAR_MODE=setup`: case 7 fails. Case 2: add an unknown key to a temp copy of `managed.json` in a temp image: it fails. Case 5: point `--settings` at a nonexistent file: it fails. Case 6: drop one `--mcp-config` entry: it fails.
- **Anything surprising** (a mismatch with § Claude Code syntax, an unknown settings key, a changed init shape) goes in the report as a proposed record for the orchestrator; do not work around it.
- **Checks:** `./scriptorium.ps1 pnpm vitest run tests/image/cli.test.ts`, `./scriptorium.ps1 check`.

### Wave 4 close (rule 15)

After all six merge into `scriptorium/wave4`: the orchestrator opens the draft PR early (for the Linux run), then a docs pass (`docs/architecture.md` image section, `docs/launcher-hardening.md` H-06/H-07/H-08/H-18/H-19/H-20 "Implemented in" lines, `docs/threat-model.md` control rows), a retro, and RESUME.md. Sonnet spec-reviewers read the packets for gaps before any dispatch.
