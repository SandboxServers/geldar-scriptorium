# Scriptorium work packets: wave 7 (onboarding and acceptance), part 2: the Patron guide, Codex, acceptance, review and the owner decisions

Part of [work-packets.md](work-packets.md) (dispatch rules 1-24, Contract) and [work-packets-wave7.md](work-packets-wave7.md) (read its fan-out plan, the shared-file table and the wave 6 follow-ups first). Ledger: [README.md](README.md). Shapes not repeated here are those of [work-packets-wave6.md](work-packets-wave6.md). Written 2026-11-10.

---

## SC-70: the Patron guide

**What it is.** The one document a person follows from nothing to a living player: `template/README.md` (player-facing; it is published with the template and read by the Patron, the human who runs the player), with `docs/onboarding.md` (owner and developer side: prerequisites, values to set, the six-player path) and `docs/troubleshooting.md` (every launcher message and what to do). The exit criterion (README "Exit" item 1) is that a person following **only** the template README ends with a player repo holding a birth commit and three reflect/commit cycles.

**The voice rule (rule 7, geldar 0014).** `template/README.md` speaks to the Patron in the second person, plain and short. It never mentions this repo, packets, CI, developers or how the kit is built, and it contains none of the forbidden strings of `tests/template/check.ts` (`scriptorium`, `packet`, `SC-`, `CI`, `pnpm`, `geldar.ps1`), which are matched as case-sensitive substrings: "specific", "special" and "decide" are fine, but "specific" contains "CI" and is refused, so the coder rereads every word. Commands are in code fences and each starts with `geldar-play`.

### SC-70a: the template README and the onboarding doc (Sonnet)

- **Branch** `scriptorium/sc-70a-patron-guide`. Commit: `docs: the Patron guide (template README) and the onboarding doc`. Depends on: wave 6 and **owner decision D1** (the download address): the install section (3) of the README and the URL allow list of `readme.test.ts` cannot be written before D1 is answered, so the packet is held (BlockedDecision) until then. The README's install section needs the release asset names from `tools/release/src/package-launcher.ts` and the cosign command of `docs/release.md`; where `docs/release.md` is still thin (SC-63i is held on owner decisions) the section names the assets and the `SHA256SUMS` check and says no more than the code shows.
- **Files (4):** `template/README.md`, `docs/onboarding.md` (new), `tests/template/readme.test.ts` (new), `tests/template/check.ts` (always: export the `forbidden` list so the test imports it instead of copying it; and, only if D1 chooses the single-URL exception, add that one URL to the check).
- **`template/README.md` sections, in this order:** (1) What this is: a character that lives in a world and keeps its own memory, and what you do (be a Patron). (2) What you need: Docker, git, the GitHub CLI `gh` (signed in), PowerShell 7 on Windows, `tar`, `tmux` for several players on Linux and macOS (D-SC-09). (3) Install the launcher and check it: download the launcher archive and its checksum file, verify the signature and the checksum, unpack, put it on your path, `geldar-play --version`. (4) Make your player: `geldar-play new <id>` (what an id is; the repository it creates; **it is public by default and so is its memory** (0013); `--private`), then `geldar-play setup <id>` (the birth conversation, once), then `geldar-play play <id>`. (5) A day in a player's life: it plays, rests, reflects and commits; what "dim" and "hibernating" mean for you (the coder reads spec 5.15 and the decision records in the geldar repo, read only, and describes only what the launcher and the skills do). (6) Be a Patron, not a puppeteer (5.15.8): you may read your own player's journal and memory; you never act inside the world for it, never tell it where things are, never play for it. (7) Start with one player and watch a whole day of usage before you start another (5.15.6), then what it costs (a short paragraph with no numbers; SC-70c adds them). (8) When something stops: how to read a launcher message, `geldar-play status`, and where the longer troubleshooting guide is. (9) Getting help.
- **`docs/onboarding.md`:** the owner and developer view in one page: prerequisites, the three values in `launcher/config/world.conf` (`mcp_base`, `mcp_port`, `private_only_shards`) and what happens while they are blank, token files, the order for the first run, links to the acceptance procedure (part 2, SC-72). It is extended by SC-70b with the persona, port and dev-world sections.
- **`readme.test.ts` (the README cannot rot):** the headings above exist in order; every `geldar-play <verb>` in a code fence names a verb in the launcher's verb list (read from `launcher/geldar-play`, so a renamed verb fails); every flag shown (`--private`, `--public`, `--token-file`, `--cli`) appears in `launcher/lib/new.sh` or the parser; the README shows neither `--persona-dir` nor `GELDAR_DEV_MCP_URL` (owner call P1: the persona option is owner provisioning only; the dev override is a developer matter); none of the forbidden strings (import `forbidden` from `check.ts`, do not copy it); no URL except those on an allow list in the test (the GitHub CLI page and the address chosen under D1); no IP other than `127.0.0.1`; the file is at most 250 lines; second person (the file contains "you" and none of "we ", "our team", "the developers").
- **Revert checks:** rename a verb in the README: the verb case fails. Add the word "packet": the forbidden case fails. Remove the Patron section: the heading case fails.
- **Checks:** `./scriptorium.ps1 pnpm vitest run tests/template`, `format`, `typecheck`, `check:specs`.

### SC-70b: the troubleshooting guide (Sonnet)

- **Branch** `scriptorium/sc-70b-troubleshooting`. Commit: `docs: troubleshooting guide with a section per launcher message`. Depends on: SC-70a, SC-74c, SC-75c, SC-76d (the message keys of the persona, dev-world and port work exist and their behaviour is final).
- **Files (2):** `docs/troubleshooting.md` (new), `tools/repo-checks/src/troubleshooting.test.ts` (new).
- **`troubleshooting.md`:** one heading per message key, written as `### key`, in the order of the `messages.d` files, each with three labelled paragraphs: `What it means.`, `Why it is safe.` (what the launcher did or refused to do) and `What to do.`. Keys that are not errors (`usage`, `created`, `created_seeded`, `public_notice`, `many_players`, `dev_world_active` and the like) are listed in one table at the top under "Not a problem", each row with a non-empty explanation. Two new sections: "The world address and port" (what `mcp_port` is; a refused port is a refusal on purpose) and "Testing against a world on your own machine" (the seam, the exact shape, the Linux listen address and its LAN exposure, the clear-text token over http and the advice of a separate dev token, the loud warning, how to switch it off). Plain text, no ESC bytes.
- **Test (`troubleshooting.test.ts`):** every key in `launcher/messages.d/*.tsv` has exactly one `### key` heading or a row in the "Not a problem" table; no heading names a key that no longer exists; **every `### key` section holds its three labelled paragraphs, each with a non-empty body of at least one sentence, and every table row has a non-empty explanation**; no ESC byte; no IP other than `127.0.0.1`. **Revert checks:** add a key to a tsv: the test fails; delete a heading: it fails; empty one `What to do.` body: it fails.
- **Checks:** `./scriptorium.ps1 pnpm vitest run tools/repo-checks`, `format`, `typecheck`, `check:specs`, `check:repo`.

### SC-70d: launcher README, onboarding additions, threat-model rows and the tarball (join; Sonnet)

- **Branch** `scriptorium/sc-70d-docs-tarball`. Commit: `docs: launcher README, onboarding sections and threat-model rows; the troubleshooting guide in the launcher archive`. Depends on: SC-70a, SC-70b, SC-76b (and through SC-70b the twins SC-74c, SC-75c, SC-76d).
- **Files (6):** `launcher/README.md`, `docs/onboarding.md` (append the persona, port and dev-world sections; the persona option is described for owner and developers only, owner-only, P1), `docs/threat-model.md` (rows for the new seam `GELDAR_DEV_MCP_URL` and the owner-set port), `docs/launcher-hardening.md` (one H-08 line: the allowlist is a host and exactly one port, the URL's effective port), `tools/release/src/package-launcher.ts` and its test (adds the troubleshooting guide as `share/troubleshooting.md`, so the Patron has it next to the launcher, per owner decision D1).
- **Test:** the `package-launcher` test lists `share/troubleshooting.md` and fails when the line is removed. **Revert check:** remove the line from `package-launcher.ts`: the listing case fails.
- **Checks:** `./scriptorium.ps1 pnpm vitest run tools/release tools/repo-checks`, `format`, `typecheck`, `check:specs`, `check:repo`.

### SC-70c: the measured numbers (docs; Haiku)

- **Branch** `scriptorium/sc-70c-numbers`. Commit: `docs: the measured turns and usage per in-game day`. Depends on: SC-72a, SC-72b (their `worknotes/acceptance-wave7.md`; the numbers are measured on the mock-world runs, which is what exit item 6 names; SC-72c measures nothing).
- **Files (2):** `template/README.md` (one paragraph in section 7: the measured turns and `/usage` per in-game day on Haiku-low over three in-game days, as ranges, with the date and the kit version; no player ids, no account names), `tests/template/readme.test.ts` (one case: the paragraph contains digits and the words "per day" and no forbidden string). This closes the README exit item 6.
- **Revert check:** delete the paragraph: the case fails.

---

## SC-71: Codex CLI support (D-SC-08; gated on owner calls C1 and C3)

**Owner direction:** parity with Claude where possible. **Orchestrator ruling (decision 3):** build the kit CLI-neutral; Codex ships only after C1 (OpenAI terms for subscription use by an autonomous character on a public repository) and C3 (credential exposure: with a shell and `auth.json` on a readable filesystem, a fooled model could copy the login into an allowed memory path) are answered, and parity is never claimed without a local live proof that the path denies hold. Facts, the parity table and the unverified items (V): [worknotes/codex-parity.md](worknotes/codex-parity.md). Today `player.json` with `harness: codex` and `--cli codex` are refused (`harness_unsupported`); that stays until SC-71c.

**What is buildable now and what is not.** SC-71a and SC-71b need no owner call and ship nothing to players. SC-71c is the shipping work; it is written here as a scope list and is **re-sliced into packets with a fan-out plan** (rule 22) when C1 and C3 are answered. Nothing in SC-71c is started before.

### SC-71a: resolve what can be checked without a model (main session and owner; no coder)

- **Where:** local, in a throwaway container from the kit's Node base image, no credentials, no mounted secrets, no repo mounted read-write. **Needs owner decision D3** (this executes a downloaded binary; the research deliberately did not).
- **Install** the newest `@openai/codex` that is at least two weeks old on the day (`npm view @openai/codex time`; 0.164.0 was the newest eligible on 2026-11-09; owner call C7), exact, with `check_for_update_on_startup = false`.
- **Resolve, model-free (each answer is written next to its (V) in a new `worknotes/codex-spike.md`, with the command and the output):** `codex --version`; `codex mcp list --json` and `codex features list` against a written config; `codex execpolicy check` for a forbidden rule; `codex debug prompt-input` (does it show the loaded `AGENTS.md` and skills); whether `requirements.toml` at `/etc/codex/` is read, and whether a conflicting user value is overridden; how a managed hook directory is declared and whether hooks run without a human trust step; the hook stdin field names against the `jq` fields our three scripts read; whether stdio MCP servers receive `GELDAR_MODE` from `env`; whether `codex sandbox` can run at all inside a container with all capabilities dropped; and, with `codex sandbox`, whether a `deny_read` or a `filesystem = "deny"` path is refused when a shell reads it. The last two answer C3 option (a) without a model turn. Anything that needs a model turn is not run here (D-SC-01); it stays for a local live check after C1 and C3.
- **Output:** `worknotes/codex-spike.md` and corrections to the parity table rows 3, 7, 12 and 15. The ledger row notes the result in one line. Not a commit of code.

### SC-71b: the skills generator for `.agents/skills`, not wired into the template (Haiku)

- **Branch** `scriptorium/sc-71b-agent-skills`. Commit: `test(template): generate the Codex skills directory from the Claude skills source, not yet published`. Depends on: wave 6. Parallel with everything.
- **Files (2):** `tests/template/agent-skills.ts` (new: a pure function `agentSkills(sources)` that turns each `template/.claude/skills/<n>/SKILL.md` into the text of `.agents/skills/<n>/SKILL.md`: the same body, the frontmatter `name` and `description` kept, `disable-model-invocation` removed; the `setup` skill goes into a separate result list `setupOnly`, because Codex has no documented invocation flag (owner call C8, default: a mode-specific skills directory)), `tests/template/agent-skills.test.ts` (new).
- **Tests:** output is deterministic; each body equals its source body byte for byte; frontmatter keeps exactly `name` and `description`; the five play skills are in the main list and `setup` only in `setupOnly`; a source without `name` or `description` throws; nothing is written under `template/` (the test asserts `template/.agents` does not exist, so the allowed-files boundary test stays green).
- **Revert checks:** keep `disable-model-invocation` in the output: the frontmatter case fails. Put `setup` in the main list: the split case fails.
- **Checks:** `./scriptorium.ps1 pnpm vitest run tests/template/agent-skills.test.ts`, `format`, `typecheck`.

### SC-71c: Codex ships (GATED on C1 and C3; scope only)

Parts, each a packet or two once ungated, none before C1 and C3 and the shape calls C2, C4 to C8 are answered:

1. **Image** (C4: a second CLI in the kit image, or a separate image; the spec is frozen so a decision record in the geldar repo comes first): pinned CLI, root-owned `0444` `/etc/codex/requirements.toml` (approved MCP list of the three companions, sandbox and approval constraints, web search off, `deny_read` for `/cli-home`, managed hooks only), `CODEX_HOME=/cli-home`, build and contract tests shaped like `tests/image/*`.
2. **Template** (voice rule): `template/.codex/config.toml` (low reasoning effort, MCP tool timeouts above 240 s, web search off), `template/.agents/skills/` from SC-71b with a drift check as SC-11 has for instructions, and the settings test extended; `tests/template/allowed-files.ts` gains the paths (one owner, that packet).
3. **Launcher, both twins:** `--cli codex` and `harness: codex` accepted; a vendor-specific CLI-home volume; a Codex vendor allowlist; `-p play|setup`; first login by `codex login --device-auth`; a new `GELDAR_` variable, if any, goes into `seams.json` after SC-75a.
4. **Tests and the live proof:** model-free tests as parity table section 4 item 4 lists; a local-only live check, a twin of SC-62, that proves the path denies and the credential exposure answer chosen under C3. Parity is not claimed in `docs/clients.md` until this passes.

---

## SC-72: acceptance runs (owner and main session; no coder)

**Goal.** Run the exit criteria of [README.md](README.md) on a Windows and a Linux machine (a clean machine is no longer required, decision 49; tester feedback covers the README-only claim), then run the six first players, and record the numbers. A run uses only what a Patron has: the prerequisites (D-SC-09) and the template README.

### SC-72a: Windows and SC-72b: Linux, against the mock world

- **Needs:** a published `kit-v*` release candidate (owner decisions 4, 5 and 11 of [work-packets-wave6c.md](work-packets-wave6c.md): the first tag, the public package, the rehearsal path), SC-70b and SC-70d, and SC-76b merged together with SC-76d (Windows) or SC-76c (Linux). Without a release, the launcher and the template are installed from a locally built archive and the run does not count for exit item 4.
- **Procedure per machine (write each step's result in `worknotes/acceptance-wave7.md`):** clean machine with only the prerequisites; follow the README alone; install and verify the launcher; `new` against the mock world (the pinned mock image, started per the geldar mock README; a per-run token file; `--mock`), `setup`, then one `play` session (decision 53: functional check, not a full or multi-day run); the player repo on GitHub shows a birth commit and the session's commits; the host clone is unchanged by the session apart from fast-forwards (the check the hostile tests make); `geldar-play upgrade` produces a pull request for the next candidate (exit item 5).
- **Measure (spec 5.15.7):** with the player's `declared_model` on Haiku at low effort, (deferred to real play, decision 53; do not do this on the mock) for each in-game day record the turns (counted from the session transcript in the CLI-home volume, which the owner may read) and the `/usage` reading before and after. Write ranges, not single numbers.
- **Findings** go to the orchestrator as fix cards; a failing step is never patched around in the guide.

### SC-72c: the six first players

- **Staging (5.15.6):** one ranger first (id `ag-jason-01`), a full day watched with `/usage`, then the others one at a time, never more than three at once (`many_players` appears above three). All six share the owner's subscription limits.
- **Order of worlds:** (1) the real MCP server on the owner's machine through the local-world override (SC-75); (2) the public name on port 18443 once the owner has created the reverse proxy site and confirmed the gateway rule (decision 34: those are owner actions on production network and host configuration).
- **Persona seeds:** `geldar-play new <id> --persona-dir <dir> --token-file <file>` per ranger (SC-74), with the owner-approved files exported by geldar and the bearer token minted by geldar. The directory is outside every repository. `mcp_base` and `mcp_port` are already set in `world.conf` at this first `new` (see the owner inputs), so the `player.json` it commits holds the final public URL; the loopback run only replaces the URL at launch through the dev seam, with a separate dev token.
- **Per player record:** the repo is created, the first push holds the persona, a `play` day completes, `status` is clean, the session never reached anything but the world host and port (the proxy log of one run is read, as the live check does).

### Owner inputs for SC-72 (nothing is guessed; blanks stay blank)

| Input | Where it goes | While blank | Provided by |
|---|---|---|---|
| `mcp_base`: scheme, host and the port when it is not 443, no path (for the public world: `https://<geldar-name>:18443`). **Set before the first `new` of any real player, independent of whether the reverse proxy exists yet**: `new` writes the URL into the committed `player.json`, which must already be the final public one | `launcher/config/world.conf` | `new` without `--mock` stops with `no_world` | owner, from the geldar side |
| `mcp_port`: `18443`. **Set together with `mcp_base`, before the first `new`**, for the same reason: the validator refuses `:18443` in `player.json` while it is blank. The reverse proxy site and the gateway rule are only needed for the public run, not to set the value | `launcher/config/world.conf` | only 80 and 443 are accepted anywhere | owner |
| `private_only_shards`: the shard names whose repositories must be private (comma separated) | `launcher/config/world.conf` | `new` without `--mock` needs an explicit `--public` or `--private` and says the list is unset | owner |
| One bearer token file per player | `--token-file` at `new`; never committed or logged | `play` runs without a token and the real world refuses | geldar mints; owner holds |
| Persona directory (six players) | `--persona-dir` at `new` (owner provisioning only, P1) | players are born by `setup` instead | geldar exports, owner approves |
| GitHub sign-in for `gh` on each machine; the owner creates the six repositories by running `new` | the human's machine | `new` stops with `gh_failed` | owner |
| The release candidate tag and the public package | owner decisions 4, 5, 11 (wave 6c) | acceptance uses a local archive and does not count for exit item 4 | owner |
| Permission to change the production network (reverse proxy site, narrowing the gateway rule) | owner action, not a packet | the public name works only on the ports already open; the local world and the mock cover tests | owner |

---

## SC-73: campaign review (packet-reviewer; read only)

- **Who:** a fresh `packet-reviewer`, given the code and these inputs but not the conclusions of the earlier reviews. It never edits; the main session writes its findings to `worknotes/campaign-review.md`. Depends on: SC-72a, SC-72b, SC-72c, SC-70c, SC-77a, SC-77b.
- **Reviews:** everything the campaign merged, against geldar records 0007 to 0016 (and 0042 to 0046 as the owner has confirmed them) and the ledger, hostile and spec-driven (rule 21): the three outputs of the kit; Principle 1 (nothing lets a human act inside the world: the dev override and the persona seed in particular); the voice rule over `template/`; the README claims against launcher behaviour; the size caps; the pins table once, with `gh api` for every action SHA (wave 6 follow-up 7); the Key Vault secret path in the publish workflow (follow-up 6); the four wave 6 follow-up proofs named in part 1; the `id-token` scope of each release job; and a sample of the revert checks.
- **Output:** a list of verified findings with file, line and the input that shows each, graded as block (fix before the first real tag), fix (next release) or note. The campaign retro and the final `RESUME.md` follow (owner instruction).

---

## OWNER DECISIONS (marked; none is guessed)

Codex calls C1 to C8 are stated in full in [worknotes/codex-parity.md](worknotes/codex-parity.md) section 5; the wave 6 decisions 1 to 11 stay open in [work-packets-wave6c.md](work-packets-wave6c.md). New for this wave:

| # | Decision needed | Why it matters | What the packets assume until decided |
|---|---|---|---|
| C1, C3 | Codex terms and credential exposure | They gate SC-71c (D-SC-08) | SC-71c does not start; `harness: codex` stays refused |
| C2, C4 to C8 | Scope of "parity", one image or two, API-key mode, version cadence, pin timing, `setup` skill fallback | They shape SC-71c, not SC-71a or SC-71b | SC-71b follows the default of C8 (mode-specific directory) |
| P1 | **ANSWERED (owner, 2026-11-10): `new --persona-dir` is not for every Patron.** The persona lives in the player's own repo (`memory/identity.md`, `goals.md`), so seeding from a directory is an owner provisioning tool for the six Rangers only. It stays out of the Patron guide and out of `template/`; the card and the launcher's usage text mark it owner/operator-only. Still open inside it: whether a seeded player is born at `new` (`setup` then says `already_born`) | Decides how the six rangers come to exist | born at `new`; `setup` says `already_born` (SC-74); documented in owner and developer docs only |
| P3 | **Answered by geldar (2026-11-10): the world does not read the player repo.** Nothing on the geldar side reads the `birth:` message or identity.md headings; a player is live once the MCP has a player row and a hashed Bearer token mapped to that id. Caveats: the identity lock means `identity.md` exists in the start tree, so a seeded commit at `new` locks it the same way; the seeded commit subject is `player: <id>`; the persona seed also goes into geldar's database from the same owner-approved text as plain UTF-8, proposed limit 2000 characters (not final); do not seed from the draft files until the owner approves them. | answered |
| P2 | **Who approves the persona text and where the files sit** (outside every repository). The text becomes public with the repository (0013) | Principle: nothing private in a public repo | the owner approves; the directory is outside any repo; the launcher checks encoding and size only, not meaning |
| D1 | **Partly answered (owner, 2026-11-10): the launcher is downloaded from a GitHub release (the `release.yml` launcher asset).** **Still open: how the Patron guide points to it without the template naming this repository** (the boundary test refuses `scriptorium`; geldar 0014). Options: (a) the template README links to the release page, with one narrow exact-URL exception in `check.ts` (it names this repo's name in the URL); (b) also attach the archive to a release of `geldar-player-template`, a repo whose name passes the boundary test, and link that; (c) the Patron guide lives outside `template/` (a page on the Geldar site or the player template repo's releases page) and the template README says only "ask the person who gave you this player for the launcher address" or links that page. Whichever is chosen, the guide travels in the launcher archive as `share/troubleshooting.md`. **D1 still gates SC-70a**: the install section and the URL allow list of the README test cannot be written before the pointer is chosen | A Patron cannot follow the README without a download address; the voice rule and the boundary test are geldar 0014 | (b), as it needs no exception in the boundary test; SC-70a keeps the address in one place so a switch is one edit; SC-70a does not start until it is chosen |
| D2 | **The three values** in the table above (`mcp_base`, `mcp_port`, `private_only_shards`). `mcp_base` and `mcp_port` must be set before the first `new` of a real player, independent of the reverse proxy, because the `player.json` that `new` commits must already hold the final public URL | The real world cannot be reached until they are set; they decide which port the launcher will ever accept and which shards must be private | blank |
| D3 | **May the main session run the pinned Codex binary in a throwaway container with no credentials** (SC-71a)? | It executes an unreviewed download | not run; SC-71a waits |
| D4 | **Acceptance before the first real tag:** accept a release candidate tag as the acceptance build, or wait for the real tag | Exit item 4 needs published assets; a candidate on the real template repository is also the rehearsal (wave 6c decision 11) | a candidate tag; the final tag repeats the short path |
| D5 | **Production network:** create the reverse proxy site, narrow the gateway rule to the addresses that need it, keep 18443 closed to everything else (decision 34) | It changes who can reach the world | not done; SC-72c step 1 (loopback) and the mock cover everything before it |
| D6 | **Subscription load of six players** on one login: run them one at a time first, then at most three together | Each player uses the plan's limits | as SC-72c stages it |
| D7 | **Pending items from earlier waves** that this wave needs answered before the tag: confirm decisions 27 to 34, the wording of geldar 0044 to 0046, and send the per-blob cap note (`worknotes/geldar-record-blob-cap.md`) to geldar | The review (SC-73) checks the records | open |

## Rejected findings

- **A launcher token helper:** not built (decision 32). Tokens are minted on the geldar side and passed with `--token-file`.
- **Relaxing `valid_mcp_url` for loopback names:** rejected. `player.json` is hostile input; the dev world is a human seam with an exact shape (SC-75).
- **A port range for the world:** rejected. One port, owner-set, equal to the port in `mcp_base`'s host entry (SC-76).
- **Re-doing the four wave 6 review items** (blob cap, export attributes, the image repository pin in `upgrade`, NTFS `.git.` names): already merged; part 1 lists the proof that the wave review re-runs.
