# Scriptorium work packets: wave 7 (onboarding and acceptance), part 1: the fan-out plan and the launcher packets

Part of [work-packets.md](work-packets.md): its dispatch rules 1-24 and its Contract apply to every packet here. Ledger: [README.md](README.md). Part 2: [work-packets-wave7b.md](work-packets-wave7b.md) (SC-70 Patron guide, SC-71 Codex, SC-72 acceptance, SC-73 campaign review, the owner decisions and the owner inputs). The shared shape (branches, what a coder runs, models, findings rule, report) is that of [work-packets-wave6.md](work-packets-wave6.md) and is not repeated; the differences are below. Written 2026-11-10 against `scriptorium/wave7` (wave 6 is on `main` as PR #13). Inputs read: `worknotes/retro-wave-6.md`, `worknotes/wave6-followups.md`, `worknotes/overnight-decisions.md` (31 to 34), `worknotes/codex-parity.md`, `RESUME.md`.

## Wave 6 follow-ups: already merged, nothing to build (checked 2026-11-10 against the code)

The brief for these cards listed four small items from the Wave 6 reviews. All four are in `main` through the wave-6 fix pass (commit 479246d), so **no packet re-does them**. SC-77a and SC-77b below carry what really remains.

| Item | Where it is now | Proof to re-run at the wave review |
|---|---|---|
| Per-blob size cap in `packages/verify` (H-10) | `MAX_BLOB_BYTES` (2 MiB) and `hasOversizeBlob` in `packages/verify/src/verify.ts`; verdict `bundle_too_large`; the `it.fails` case is gone | `launcher/test/hostile/h10-size.test.ts` passes without `it.fails`. Still open: the geldar record note `worknotes/geldar-record-blob-cap.md` is not yet sent (main session, not a packet) |
| `export-ignore` and `export-subst` in `git archive` (S4) | `tree_has_export_attrs` in `launcher/lib/common.sh` (bash) and its twin; `upgrade` refuses them too | `h04-export.test.ts` passes without `it.fails` |
| Pin the image repository in `upgrade` (S6) | `up_validate` accepts only `ghcr.io/sandboxservers/geldar-kit@sha256:` in both launchers | `upgrade.bash.test.ts`, `upgrade.pwsh.test.ts` |
| NTFS `.git.` and `.git ` variants in `up_validate` (N-e) | the `.[gG][iI][tT][.\ ]+` check in `upgrade.sh` and its PowerShell twin | same two files |

Also already done: the launcher-sign job (the SBOM is signed in `launcher-sign`, N-d) and the `id-token` scope per job (N-b). The wave review re-reads `release.yml` once to confirm.

## FAN-OUT PLAN (rule 22)

Three launcher strands (world port SC-76, persona seed SC-74, local-world override SC-75), two docs strands (SC-70 Patron guide, SC-77 hygiene), one research strand (SC-71 Codex), then the acceptance runs (SC-72, owner plus main session) and the campaign review (SC-73). SC-76 comes first because SC-75 builds on its allowlist writer and SC-74 shares no file with it. Every gate below is small and its files are listed once.

| Step | Packets (all siblings in a step run at once) | Why here |
|---|---|---|
| **0. Review** | The main session spec-reviews these cards (SC-75 and SC-76 widen egress; SC-74 changes when a player is born). Nothing is dispatched before. | Owner ruling in the ledger rows |
| **1. Gates and independents** | **SC-76a** (port tables, suite, `world.conf` key), **SC-76b** (Squid port rule, compose, image tests), **SC-74a** (persona suite, cases, messages), **SC-75a** (dev-world suite, cases, messages, seam list), **SC-70a** (README and onboarding), **SC-71a** (Codex checks that need no owner call), **SC-71b** (skills generator, not wired), **SC-77a** (twin-drift check), **SC-77b** (container recipe for Linux-only tests) | None needs another; the ones that are gates for later packets are tiny |
| **2. Parallel** | **SC-76c** (bash), **SC-76d** (PowerShell) after SC-76a; **SC-74b** (bash), **SC-74c** (PowerShell) after SC-74a | Twins in disjoint files |
| **3. Parallel** | **SC-75b** (bash), **SC-75c** (PowerShell) after SC-75a, SC-76c, SC-76d | They use the allowlist writer SC-76 changed |
| **4. Join** | **SC-70b** (troubleshooting, onboarding additions, launcher README, tarball) after SC-74c, SC-75c, SC-76b, SC-76d and SC-70a | Documents every refusal that now exists |
| **5. Owner** | **SC-72a**, **SC-72b**, **SC-72c** (acceptance runs), then **SC-70c** (the measured numbers), then **SC-73** | Needs the owner inputs in part 2 |
| **Gated** | **SC-71c** (Codex ships) waits for owner calls C1 and C3 (D-SC-08) | Not on the critical path |

```
SC-76a                         <- wave 6 only
SC-76b                         <- wave 6 only (the file contract is fixed in the card)
SC-76c, SC-76d                 <- SC-76a
SC-74a, SC-75a                 <- wave 6 only
SC-74b, SC-74c                 <- SC-74a
SC-75b, SC-75c                 <- SC-75a, SC-76c, SC-76d
SC-70a, SC-71a, SC-71b, SC-77a, SC-77b <- wave 6 only
SC-70b                         <- SC-70a, SC-74c, SC-75c, SC-76b, SC-76d
SC-72a, SC-72b, SC-72c         <- SC-70b, SC-76b, SC-76c, SC-76d (and the owner inputs)
SC-70c                         <- SC-72a, SC-72b, SC-72c
SC-73                          <- SC-72a, SC-72b, SC-72c, SC-70c, SC-77a, SC-77b
SC-71c                         <- SC-71a, SC-71b and owner calls C1, C3 (gated)
```

**Critical path:** SC-76a, SC-76c or SC-76d, SC-75b or SC-75c, SC-70b, SC-72, SC-70c, SC-73. The owner part (SC-72) is the long one and starts the moment the join merges.

## Shared files and their owners (rule 13)

| File | Owner | Why only one |
|---|---|---|
| `launcher/config/world.conf` | SC-76a (adds the key `mcp_port`) | the owner fills the values in SC-72; no other packet edits it |
| `launcher/test/hostile/seams.json` | SC-75a (adds `GELDAR_DEV_MCP_URL` as a human seam) | N8 requires every `GELDAR_` variable to be classified; no other packet adds a variable. SC-71c may need one: it then starts after SC-75a and takes the file from SC-75a's owner slot, never in parallel |
| `launcher/lib/session.sh`, `launcher/lib/session.ps1` | SC-76c, SC-76d (the allowlist writer), then SC-75b, SC-75c (one hook line each) | SC-75 starts after SC-76 has merged |
| `launcher/lib/player.sh`, `launcher/lib/player.ps1` | SC-76c, SC-76d (`valid_mcp_url`) | nobody else touches the validator; SC-75 never relaxes it |
| `launcher/lib/new.sh`, `launcher/lib/new.ps1` | SC-74b, SC-74c | SC-76 only reads `world_conf` / `Get-WorldConf` from them |
| `launcher/messages.d/56-persona.tsv`, `launcher/messages.d/57-devworld.tsv` | SC-74a, SC-75a (new files) | each packet adds keys in its own file; the loader reads every `*.tsv` (confirm in `common.sh` / `common.ps1`) |
| `image/proxy/squid.conf`, `image/compose/session.yml`, `tests/image/egress.test.ts`, `tests/image/proxy-config.test.ts` | SC-76b | SC-75 changes none of them (its host entry goes through the launcher's override file) |
| `launcher/test/parity.ts` | **nobody this wave** | no new group is needed: the new twin tests pick their launcher by name (as `statedir.*.test.ts` does). A packet that finds it needs a group stops and reports. SC-77a only reads the file |
| `launcher/README.md`, `docs/onboarding.md`, `docs/troubleshooting.md`, `docs/threat-model.md`, `docs/launcher-hardening.md` | SC-70b (join) | the join writes the docs once. `docs/onboarding.md` is created by SC-70a and then owned by SC-70b |
| `template/README.md`, `tests/template/readme.test.ts` | SC-70a, then SC-70c (one section) | SC-70c runs after SC-70a has merged |
| `tools/release/src/package-launcher.ts` and its test | SC-76b (adds the ports default file), then SC-70b (adds the troubleshooting guide) | SC-70b runs after SC-76b |
| `pnpm-lock.yaml`, root `package.json` | nobody | this wave adds no package |

**Nothing in this wave edits `docs/spec.md` or the geldar repo.** The only `template/` edit is `template/README.md` (SC-70a, SC-70c); everything in it follows the voice rule (rule 7) and the boundary test's forbidden words (`tests/template/check.ts`: `scriptorium`, `packet`, `SC-`, `CI`, `pnpm`, `geldar.ps1`; the check is case-sensitive and substring-based, so the word "specific" is also refused, because it contains "CI"). Principle 1 holds in every test: nothing here lets a human act inside the world.

**Differences from the wave 6 shape.** Branch `scriptorium/sc-<id>-<slug>`, worktree `.claude/worktrees/sc-<id>`, from `scriptorium/wave7`. Packets here have **no digit-suffixed ids** (the ledger lint cannot see them). Rule 19 applies: any bounded, polling or sleeping case uses `timingIt` from `launcher/test/timing.ts`; the cards below name none because none is expected. Linux-only cases (modes, symlinks) skip on win32 with a reason and run in CI.

---

## SC-76: the world port 18443 (owner decision 2026-11-09, decision 34)

**Why.** The real world's MCP is served on public port 18443 over TLS. Today the validator accepts only 80 and 443 (`valid_mcp_url` in `player.sh`, `player.ps1`) and Squid allows only `Safe_ports` 80 and 443. The change must widen exactly one thing: one port, set by the owner in `world.conf`, for one host, the host of `mcp_base`.

**The rule (the contract all four packets build against).**

1. `launcher/config/world.conf` gets the key `mcp_port` (owner-set; blank means only 80 and 443 are ever accepted). Valid value: digits only, no leading zero, 1024 to 65535. Anything else is treated as blank.
2. `valid_mcp_url` accepts an explicit port other than 80 and 443 **only if** `mcp_port` is valid, the port equals it, `mcp_base` is non-blank, and the URL's host equals the host of `mcp_base` (compared case-sensitively after both pass the existing host rules; the port part of `mcp_base` is ignored in the comparison). The rule reads `world.conf` as data (never sourced) with `world_conf` / `Get-WorldConf`, through the human seam `GELDAR_SHARE` that tests already use. It reads the file only when a non-default port is present. The port in `player.json` can never widen anything: it is compared with a value the launcher read from its own shipped config.
3. The session gets the effective port of the world URL in a one-line file `pub/allowlist-world-ports.txt` (the explicit port, or 80 for `http` and 443 for `https` when none is given) next to `pub/allowlist-world.txt`, 0644 in the 0755 `pub/` like it. The launcher exports its path as `GELDAR_WORLD_PORTS` to `compose`. The compose file mounts it at `/etc/squid/allowlist-world-ports.txt`, with a default of `image/proxy/world-ports-default.txt` (one line, `443`) so the image tests and any compose run without the launcher keep working.
4. Squid (written exactly so; `(V)` = the coder confirms the syntax with `squid -k parse` in the pinned Squid, as `proxy-config.test.ts` does): `acl world_port port "/etc/squid/allowlist-world-ports.txt"`, then `http_access deny !Safe_ports !world_port`, `http_access deny CONNECT !SSL_ports !world_port`, `http_access allow allowed_vendor Safe_ports`, `http_access allow allowed_world Safe_ports`, `http_access allow allowed_world world_port`, `http_access deny all`. If the `"file"` form is not accepted for `port` ACLs (V), fall back to an `include /etc/squid/world-access.conf` file that the launcher writes from the validated number; the card's tests stay the same.
5. No new message key: a refused port is `bad_url` (for `new`) or `pj_fail ... 'mcp_url'` (for a player.json), as today.

### SC-76a: port tables, suite and the `world.conf` key (gate; Haiku)

- **Branch** `scriptorium/sc-76a-port-tables`. Commit: `test(launcher): add the mcp_port case table and suite, and the mcp_port key`. Depends on: wave 6.
- **Files (4):** `launcher/test/mcp-port-cases.json` (new), `launcher/test/mcp-port-suite.ts` (new), `launcher/test/mcp-port-cases.test.ts` (new, table shape only), `launcher/config/world.conf` (add `mcp_port=` with a comment saying it is owner-set, blank means 80/443 only, and that `mcp_base` carries the same port).
- **Table** rows `{base, port, url, ok}`; `base` and `port` are what `world.conf` holds in that row. Required rows (at least): blank port with `:18443` is refused; port 18443 with base `https://world.example.com:18443` accepts `https://world.example.com:18443/p/x`; the same with host `other.example.com` is refused; `:8443` is refused; `:18444` is refused; `:80` and `:443` accepted in every row; `mcp_port` 22, 80, 443, 1023, 65536, `018443`, `18443x`, ` 18443` are all treated as blank (so `:18443` is refused); blank `mcp_base` with port set is refused; `http` with the port is accepted (the mock); userinfo, query, `..` and a private name with the good port are refused; `:18443` appended twice and `:+18443` are refused.
- **Suite** `mcpPortSuite(launcher)`: builds a temp share dir with `config/world.conf` per row, sets `GELDAR_SHARE`, runs every row through the launcher's own check in one process (same method as `urlSuite` in `mcp-url-suite.ts`; do not edit that file) and compares with `ok`.
- **Tests:** the shape test (unique rows, fields present, every `ok` boolean). Nothing runs the suite until SC-76c and SC-76d import it, so this packet merges green.
- **Revert check:** delete a field from one row: the shape test fails.
- **Checks:** `./scriptorium.ps1 pnpm vitest run launcher/test/mcp-port-cases.test.ts`, `format`, `typecheck`.

### SC-76b: Squid port rule, compose and image tests (Sonnet)

- **Branch** `scriptorium/sc-76b-squid-port`. Commit: `feat(image): allow exactly the owner-set world port through the proxy`. Depends on: wave 6. Parallel with SC-76a.
- **Files (8):** `image/proxy/squid.conf`, `image/proxy/world-ports-default.txt` (new), `image/compose/session.yml`, `tests/image/proxy-config.test.ts`, `tests/image/egress.test.ts`, `tests/image/fixtures/allowlist-world-ports.txt` (new, `18443`), `tools/release/src/package-launcher.ts` and `tools/release/src/package-launcher.test.ts` (the tarball lists its `share/` files one by one: without `share/proxy/world-ports-default.txt` the released launcher's compose file would point at a missing mount).
- **Change:** rule 3 and rule 4 above. The health check line stays as is.
- **Tests:** `proxy-config.test.ts` (structure, no Docker): the config has the `world_port` ACL and the five `http_access` lines in the order above, no `Safe_ports` line was widened, and the default ports file is exactly `443\n`. Squid parses the shipped config (existing case). `egress.test.ts` (Docker, 120_000 ms): with the fixture ports file `18443` and a fake world listening on 18443, the world host answers on 18443; port 8080 on the same host is still 403 (existing case kept); 18443 on the vendor host (a name from `allowlist-vendor.txt`) is 403; with the default file, 18443 is 403 again.
- **Revert checks:** drop the `allow allowed_world world_port` line: the 18443 case fails. Put `world_port` into the vendor rule: the vendor-on-18443 case fails. Delete the default file: the structure case fails. Remove the new line from `package-launcher.ts`: the tarball listing case fails.
- **Checks:** `./scriptorium.ps1 pnpm vitest run tests/image/proxy-config.test.ts`; the Docker cases run in CI (rule 14).

### SC-76c: validator and allowlist writer, bash (Sonnet) and SC-76d: the same, PowerShell (Sonnet)

- **Branches** `scriptorium/sc-76c-port-bash`, `scriptorium/sc-76d-port-pwsh`. Commits: `feat(launcher): accept the owner-set world port in mcp_url and tell the proxy (bash)` and `... (PowerShell)`. Depend on: SC-76a. Parallel with each other and with SC-76b (the file contract above is fixed).
- **Files (c):** `launcher/lib/player.sh` (`valid_mcp_url`), `launcher/lib/session.sh` (`write_allowlist` writes the ports file; `start_session` exports `GELDAR_WORLD_PORTS`), `launcher/test/hostile/mcpport.bash.test.ts` (new). **Files (d):** `launcher/lib/player.ps1`, `launcher/lib/session.ps1`, `launcher/test/hostile/mcpport.pwsh.test.ts` (new). Read `world_conf` / `Get-WorldConf` from `new.sh` / `new.ps1`; every `lib/*` file is sourced for every verb, so no edit is needed there (confirm; if not, stop and report).
- **Tests (each twin, 60_000 ms per case):** `mcpPortSuite(launcher)` agrees with the table. Then: `read_player` on a committed `player.json` with `:18443` and the shipped (blank) `world.conf` ends in the `mcp_url` refusal, and `new --mock http://world.test:18443` is `bad_url` under the blank config. With a share dir that sets the port and base: a session start writes `pub/allowlist-world.txt` (host only, one line) and `pub/allowlist-world-ports.txt` holding exactly `18443`, both 0644, and `GELDAR_WORLD_PORTS` reaches `compose` (read from the fake docker's recorded environment); a default URL writes `443` (or `80` for `http`). A `player.json` whose host differs from `mcp_base` on port 18443 ends in the refusal and no docker call. The existing `mcp-url-cases.json` table still passes unchanged (`urlSuite`).
- **Revert checks:** accept any port when `mcp_port` is blank: the suite fails. Skip the host comparison: the different-host row fails. Write the host into the ports file: the contents case fails.
- **Checks:** `./scriptorium.ps1 pnpm vitest run launcher/test/hostile/mcpport.bash.test.ts launcher/test/mcp-url-cases.test.ts launcher/test/session.test.ts` (and the pwsh twin), `format`, `typecheck`.

---

## SC-74: `new --persona-dir` (decision 32; owner requirement relayed by geldar 2026-11-09)

**Why.** The six first players are the Power Rangers, each with an owner-approved persona, exported by geldar as `<id>/memory/identity.md` and `<id>/memory/goals.md` (player ids `ag-jason-01`, `ag-zack-01`, `ag-billy-01`, `ag-trini-01`, `ag-kimberly-01`, `ag-tommy-01`).

**Finding that shapes the design (read before coding).** `setup` refuses with `already_born` when `memory/identity.md` is not the template stub (`prepare.sh` line 117 and the PowerShell twin), and `setup_empty` refuses a setup that leaves the stub. So a seeded identity cannot be followed by `setup`. **Design, to be confirmed in the spec review (owner call P1):** a seeded player is born by `new`. `new --persona-dir <dir>` writes the two files into the clone and commits them in the one `player: <id>` commit, so the first push already holds the persona; `setup` then correctly says `already_born`, and the next step is `play`. No change to `setup`, to the path rule or to the template. The summary file stays the template stub; the character writes it in its first reflect. If the owner wants the character to introduce itself in a conversation, the persona is not used for that player.

**Rules (the contract).** `--persona-dir <dir>` is an option of `new` only. The directory must exist, must not be a symlink, and is read through exactly two paths, `<dir>/<id>/memory/identity.md` and `<dir>/<id>/memory/goals.md` (`<id>` is the validated player id; nothing else in the directory is listed or read). Both files must be regular files (not symlinks), identity 1 to 8192 bytes, goals 1 to 4096 bytes, valid UTF-8, no NUL, no control character except LF and TAB, no bidirectional controls (U+202A to U+202E, U+2066 to U+2069) and no zero-width characters (U+200B to U+200D, U+2060, U+FEFF); CRLF is normalised to LF. Everything is validated **before** any `gh` call, so a bad persona creates nothing ("Nothing was created", as `new` already says). The files are written after the clone and before the commit, and added with `player.json`. The repository visibility rules are unchanged (the persona is public when the repository is; `public_notice` already says memory is public).

### SC-74a: persona suite, cases and messages (gate; Haiku)

- **Branch** `scriptorium/sc-74a-persona-suite`. Commit: `test(launcher): add the persona-dir case table, suite and message keys`. Depends on: wave 6.
- **Files (4):** `launcher/test/persona-suite.ts` (new), `launcher/test/persona-cases.json` (new), `launcher/test/persona-cases.test.ts` (new, table shape only), `launcher/messages.d/56-persona.tsv` (new: `persona_missing`, `persona_bad` (with the reason word), `created_seeded`: "Created %s with the persona you gave. It is already born, so setup is not needed. Next: geldar-play play %s", `persona_win_link`).
- **Cases** `{name, files, expect}` where `expect` is `ok` or a message key: both files fine; goals missing; identity missing; empty file; 8193-byte identity; 4097-byte goals; NUL; ESC byte; bidi override; zero-width space; BOM; invalid UTF-8; CRLF (ok, stored LF); symlink as identity (skipped on win32 without the privilege); `--persona-dir` pointing at a file; the directory holding only another player's id; the id directory holding extra files (ok, extras never read); `--persona-dir` twice.
- **Suite** `personaSuite(launcher)`: builds the directory per case, runs `new` against the fake `gh` and the template fixture the `new` tests use (`launcher/test/new.test.ts` shows it), and asserts: on `ok` the clone's `HEAD` commit changes exactly `player.json`, `memory/identity.md` and `memory/goals.md` and the stored bytes equal the normalised input; the success line is `created_seeded`; a following `setup` ends in `already_born`. On a key: stderr holds that message (read from the tsv, so a renamed text fails), exit status 1, the fake `gh` log has no `repo create`, and no player directory exists.
- **Tests:** a shape test over the table. **Revert check:** delete a row's `expect`: the shape test fails.
- **Checks:** `./scriptorium.ps1 pnpm vitest run launcher/test/persona-cases.test.ts`, `format`, `typecheck`.

### SC-74b: `--persona-dir`, bash (Sonnet) and SC-74c: the same, PowerShell (Sonnet)

- **Branches** `scriptorium/sc-74b-persona-bash`, `scriptorium/sc-74c-persona-pwsh`. Commits: `feat(launcher): new --persona-dir seeds identity and goals (bash)` and `... (PowerShell)`. Depend on: SC-74a.
- **Files (b):** `launcher/lib/new.sh`, `launcher/test/persona.bash.test.ts` (new, runs `personaSuite` for the bash launcher). **Files (c):** `launcher/lib/new.ps1`, `launcher/test/persona.pwsh.test.ts` (new). The byte checks use the same method in both: read bytes, validate, then write; PowerShell must not decode through the console code page and must write LF without a BOM.
- **Extra tests:** a token file together with the persona (both honoured); `--persona-dir` with `--mock`; the existing `new` tests pass unchanged without the option (the success line is `created` again).
- **Revert checks:** drop the size check: the 8193-byte row fails. Stage the files after the commit: the changed-files assertion fails. Validate after `gh repo create`: the "no `repo create`" assertion fails.
- **Checks:** `./scriptorium.ps1 pnpm vitest run launcher/test/persona.bash.test.ts launcher/test/new.test.ts` (and the pwsh twin), `format`, `typecheck`.

---

## SC-75: the local-world dev override (decision 33; owner decision relayed 2026-11-09: test the MCP on loopback first)

**Why.** Ranger number one is tested against a real MCP server on the owner's own machine before the public name exists. `player.json` is hostile input, so the validator is not relaxed (SC-60m and SC-60n refuse local and private names, and stay that way). Instead one human-environment seam names the dev world; it is never read from `player.json` or any repository file.

**Rules (the contract).**

1. The seam is the environment variable `GELDAR_DEV_MCP_URL`, set by the human in the shell that runs `geldar-play`. It is a human seam (like `GELDAR_STATE_DIR`): ungated, classified in `seams.json` by SC-75a, documented in the launcher README by SC-70b, and never passed into the session container.
2. When set, its value must match **exactly** `http://host.docker.internal:<port>/p/<player_id>` with port 1024 to 65535 (digits, no leading zero) and `<player_id>` equal to the id of the player being started. Lowercase only; no userinfo, query, fragment, trailing slash, whitespace or other path. A set but invalid value is a refusal (`dev_world_bad`, status 1, no docker call), never silently ignored.
3. It applies only to a single-player `play` or `setup`. With two or more ids and the variable set, `play` refuses (`dev_world_single`) so one URL cannot reach a second player.
4. `player.json` is still read and validated as today (its `mcp_url` must pass `valid_mcp_url`). The dev URL replaces only the `GELDAR_MCP_URL` value passed to the session and the world allowlist for that launch. `write_allowlist` receives host `host.docker.internal` and the port, so `pub/allowlist-world.txt` is exactly `host.docker.internal` and `pub/allowlist-world-ports.txt` exactly the port (SC-76's mechanism, no new Squid rule).
5. The launcher-written `override.yml` gains, only when the seam is active, a `proxy` service block with `extra_hosts: ["host.docker.internal:host-gateway"]` (Docker Desktop resolves the name natively; a Linux engine needs it, and then the local MCP must listen on `0.0.0.0` or the bridge gateway address, which the guide says). With the seam unset, `override.yml` is byte-identical to today's.
6. Every launch with the seam active prints `dev_world_active` to stderr first (a loud, plain line naming the URL and how to turn it off). The seam is read at launch only: nothing is persisted in the state dir, `player.json` or the clone.
7. The bearer token is the player's own stored token, exactly as for the real world.

### SC-75a: dev-world suite, cases, messages and the seam entry (gate; Haiku)

- **Branch** `scriptorium/sc-75a-devworld-suite`. Commit: `test(launcher): add the dev-world case table, suite, message keys and seam entry`. Depends on: wave 6.
- **Files (5):** `launcher/test/devworld-suite.ts` (new), `launcher/test/devworld-cases.json` (new), `launcher/test/devworld-cases.test.ts` (new, shape), `launcher/messages.d/57-devworld.tsv` (new: `dev_world_active`, `dev_world_bad`, `dev_world_single`), `launcher/test/hostile/seams.json` (add `GELDAR_DEV_MCP_URL` to `human_seams`).
- **Cases** `{value, player, ok}`: the exact good URL; port 1023, 0, 65536, 80, 443, 22, `08787`, `8787x`; `https`; host `localhost`, `127.0.0.1`, `host.docker.internal.evil.test`, `host.docker.internal@evil.test`, `HOST.DOCKER.INTERNAL`, `host.docker.internal.`; path for another id, `/p/<id>/x`, `/p/<id>/`, `/p/<id>?a=1`, `/p/<id>#f`, `/p/../<id>`; a space, a newline, a tab; userinfo; a second URL after a space.
- **Suite** `devWorldSuite(launcher)`: for each row runs `__session`-level start through the fake docker (as `session.test.ts` does) and asserts: `ok` rows start, `GELDAR_MCP_URL` in the recorded compose environment equals the value, both allowlist files hold exactly the host and the port, and `dev_world_active` is on stderr; other rows end in `dev_world_bad`, status 1, no docker call (`expectNoDockerCall`) and no allowlist file; with the variable unset the override file equals a stored copy of today's output.
- **Revert check:** delete a row's `ok`: the shape test fails.
- **Checks:** shape test, `format`, `typecheck`.

### SC-75b: the dev-world override, bash (Sonnet) and SC-75c: the same, PowerShell (Sonnet)

- **Branches** `scriptorium/sc-75b-devworld-bash`, `scriptorium/sc-75c-devworld-pwsh`. Commits: `feat(launcher): human-only local-world override for testing the MCP on loopback (bash)` and `... (PowerShell)`. Depend on: SC-75a, SC-76c (b) or SC-76d (c).
- **Files (b):** `launcher/lib/devworld.sh` (new: `dev_world_url id` returns the validated URL or fails), `launcher/lib/session.sh` (one hook where `PL_MCP_URL` is used for the override and the allowlist; reached from `start_session`), `launcher/lib/multi.sh` (the `dev_world_single` refusal), `launcher/test/hostile/devworld.bash.test.ts` (new). **Files (c):** `launcher/lib/devworld.ps1`, `launcher/lib/session.ps1`, `launcher/lib/multi.ps1`, `launcher/test/hostile/devworld.pwsh.test.ts`.
- **Hostile cases beyond the suite (each twin):** a `player.json` with `http://host.docker.internal:8787/p/x` is still refused by `valid_mcp_url` (the seam does not loosen it); a file named `dev-world` or a line `GELDAR_DEV_MCP_URL=...` in the clone is ignored; the variable is absent from the container environment in the recorded compose config; two ids with the variable set is `dev_world_single` and starts nothing; the override is not written for the player started next with the variable unset (no state leaks); the seam check in `seams.test.ts` stays green.
- **Revert checks:** accept a different player id in the path: the other-id row fails. Persist the URL into the state dir: the no-leak case fails. Skip the `dev_world_single` check: the two-id case fails.
- **Checks:** `./scriptorium.ps1 pnpm vitest run launcher/test/hostile/devworld.bash.test.ts launcher/test/hostile/seams.test.ts launcher/test/session.test.ts` (and the pwsh twin), `format`, `typecheck`.

---

## SC-77: hygiene that remains from the Wave 6 retro

### SC-77a: a repo check that catches twin drift (Sonnet)

- **Branch** `scriptorium/sc-77a-twin-drift`. Commit: `test(repo-checks): fail when the bash and PowerShell launchers disagree on groups or private directories`. Depends on: wave 6.
- **Files (3):** `tools/repo-checks/src/twin-drift.ts` (new, pure functions over text), `tools/repo-checks/src/twin-drift.test.ts` (new), `tools/repo-checks/src/cli.ts` (one line that runs the new check inside the existing `check:repo`; the coder finds where that command composes its checks; nobody else edits `cli.ts` this wave, and no `package.json` edit is needed).
- **Check:** (1) the capability groups each twin registers (`GP_GROUPS="$GP_GROUPS name"` in `launcher/lib/*.sh`, the PowerShell equivalent in `launcher/lib/*.ps1`) are the same set, and equal the union of `enabled.bash` and `enabled.pwsh` in `launcher/test/parity.ts` minus `testOnlyGroups`. (2) The directories `prepare.sh` and `prepare.ps1` create or tighten (the state root, the player dir, `session`, `pub`, `export`, `held`) are the same list, found by the private-directory helper calls; a directory one twin tightens and the other creates plainly is a finding. The coder derives the exact patterns by reading both files and states them at the top of the module.
- **Tests (fixtures, no launcher):** equal sets pass; one extra group in the PowerShell fixture fails and names it; a `prepare.sh` fixture that tightens one directory less fails and names it; the real repo passes.
- **Revert check:** add a fake group to `session.ps1`: the real-repo case fails.
- **Checks:** `./scriptorium.ps1 pnpm vitest run tools/repo-checks/src/twin-drift.test.ts`, `format`, `typecheck`, `check:repo`.

### SC-77b: a container recipe for the Linux-only tests (Haiku)

- **Branch** `scriptorium/sc-77b-linux-recipe`. Commit: `docs: run the Linux-only test files in a container before pushing`. Depends on: wave 6.
- **Files (2):** `docs/linux-tests.md` (new: the exact commands to run a named Linux-only test file from a Windows or macOS machine in a container: the Node image **by digest**, the same digest as `image/Dockerfile`'s base; the repo mounted read-only with a writable copy of the tree inside the container; `pnpm install` inside; the list of files that need Linux, `jq` or bash modes: `launcher/test/hostile/statedir.bash.test.ts`, `tests/hostile/h18-hooks.test.ts` and the bash twins; what cannot run there: the Docker-in-Docker image tests), `tools/repo-checks/src/linux-recipe.test.ts` (new: the digest in the doc equals the one in `image/Dockerfile`, every file the doc names exists, and the doc has no IP other than `127.0.0.1`).
- **Revert check:** change one digit of the digest in the doc: the test fails.
- **Checks:** `./scriptorium.ps1 pnpm vitest run tools/repo-checks/src/linux-recipe.test.ts`, `format`, `typecheck`, `check:specs`.
