# Codex CLI parity with Claude Code (D-SC-08 research)

Verified 2026-11-09 against OpenAI's docs (developers.openai.com/codex/... redirects to learn.chatgpt.com/docs/...), the `openai/codex` GitHub repo and `npm view @openai/codex`. Owner direction: "parity with Claude where possible". This note states facts and options; the OWNER CALLS section lists what is not mine to decide.

Method limit: docs were read through a summarizing fetch tool, not raw. Treat quoted keys as "seen in a summary of the page"; every item marked (V) must be re-checked by running the pinned binary (see "Could NOT verify").

## 1. Facts found

### 1.1 Version, license, pin
- `@openai/codex` latest on npm: 0.167.0 (published 2026-11-06). Repo license Apache-2.0 (GitHub API). Releases are roughly weekly (0.160.0 on 2026-10-01 to 0.167.0 on 2026-11-06).
- Two-week rule: newest eligible today is **0.164.0** (published 2026-10-23, 17 days old). 0.165.0 (2026-10-27) is 13 days old, not eligible yet.
- The npm package is a thin launcher (`bin/codex.js`, about 13 KB unpacked); the native binary comes as a platform package. Pin: `npm install -g @openai/codex@0.164.0`. Whether the platform package is also exactly pinned by a global install: (V).
- Auto-update: `check_for_update_on_startup` (boolean); the reference says set `false` only when updates are centrally managed. No env var like `DISABLE_AUTOUPDATER` found. Source: https://learn.chatgpt.com/docs/config-file/config-reference (2026-11-09).

### 1.2 Terms (question 1)
- **Not verified.** OpenAI's Terms of Use page returned HTTP 403 to the fetch tool; search only gave third-party copies of the general Terms of Use. Those contain a ban on automated or programmatic extraction of data or output "except as permitted through the API", and a ban on circumventing rate limits or protective measures. Versions and dates unknown. No Codex-specific term found.
- What the Codex docs say (primary, 2026-11-09), https://learn.chatgpt.com/docs/auth/ci-cd-auth:
  - "The right way to authenticate automation is with an API key"; API keys are "the recommended option for most CI/CD jobs".
  - ChatGPT-managed auth in automation is an advanced path: use only when you need to run as your Codex account, `codex login` cannot run on the runner, and the runner is trusted private infrastructure.
  - "Do not use this workflow for public or open-source repositories."
  - "Use one `auth.json` per runner or per serialized workflow stream." "Do not share the same file across concurrent jobs or multiple machines."
  - Multiple accounts: not discussed.
- Reading for Geldar: a long, unattended-ish character session in a container on the player's own machine, with the player's own login, working in a public player repo (geldar 0013/0015). That is outside the documented "trusted private runner" case. Whether it breaches any term is a legal reading I cannot make. See OWNER CALL C1.
- Help-center release notes mention Codex "access tokens" for approved non-interactive workflows under a ChatGPT workspace identity (Business/Enterprise). Not a personal-subscription path. Seen only in a search snippet.
- Third-party reports say ChatGPT and Codex usage limits become shared from December 2026; unconfirmed.

### 1.3 MCP (question 2): https://learn.chatgpt.com/docs/extend/mcp?surface=cli
- Transports: stdio and Streamable HTTP. Servers are `[mcp_servers.<name>]` tables in `config.toml` (user `~/.codex/config.toml`, or `.codex/config.toml` in a trusted project).
- Streamable HTTP auth: `bearer_token_env_var = "NAME"`; OAuth via `codex mcp login <name>` (`--no-browser` for paste-back); keys `oauth.client_id`, `oauth_resource`, `scopes`, plus `http_headers`, `env_http_headers`. Whether the flow is OAuth 2.1 with PKCE and dynamic client registration: not stated (V).
- Tool filtering: `enabled_tools` (allow) and `disabled_tools` (deny, applied after).
- stdio environment: `env = { GELDAR_MODE = "play" }` sets variables; `env_vars = [...]` forwards named variables from Codex's own environment. So `GELDAR_MODE` can pass either way. Whether Codex otherwise scrubs the environment given to stdio servers: (V). This matters because tests/image/cli.test.ts asserts `GELDAR_MODE` reaches the servers only when set.
- `codex mcp list --json` and `codex mcp get <name> --json` exist per the CLI reference https://learn.chatgpt.com/docs/developer-commands?surface=cli.
- Requirements can approve an `mcp_servers` list; an empty list disables all MCP servers.

### 1.4 Managed and locked configuration (question 3): https://learn.chatgpt.com/docs/enterprise/managed-configuration.md
- Files: `/etc/codex/requirements.toml` and `/etc/codex/managed_config.toml` on Linux/macOS. Windows: `%ProgramData%\OpenAI\Codex\requirements.toml`; `managed_config.toml` at `~/.codex/managed_config.toml` on non-Unix. The container is Linux, so `/etc/codex/` is the path, the same shape as `/etc/claude-code/managed-settings.json`.
- Two layers of different strength:
  - **requirements.toml is enforced.** "Users can't override them"; on conflict the client "falls back to a compatible value and notifies the user".
  - **managed_config.toml is managed defaults.** Highest precedence at start (above user `config.toml` and above `-c` flags), but "users can change these settings during a run"; they reapply at next start.
- Keys requirements can constrain: `allowed_approval_policies`; `allowed_sandbox_modes` (legacy) or, from 0.138.0, `allowed_permission_profiles` and `default_permissions`; `allowed_web_search_modes`; managed hooks; an `mcp_servers` approved list; `[rules]` command rules with `prompt` or `forbidden` (no `allow`); `[features]`; `[permissions.filesystem]` with `deny_read`; `[network_proxy]`.
- Path denies in ordinary config: `permissions.<name>.filesystem.<path-or-glob> = "read" | "write" | "deny"` (config reference).
- Sandbox modes: `read-only`, `workspace-write`, `danger-full-access`. Approval: `on-request`, `never`, `granular`; `untrusted` retired. Network off by default; `[sandbox_workspace_write] network_access = true`; `features.network_proxy` constrains traffic once on. Source: https://learn.chatgpt.com/docs/agent-approvals-security.md
- Protected paths: under `workspace-write`, `.git`, `.agents`, `.codex`, `.aws` stay read-only recursively even inside writable roots.
- Project `.codex/config.toml` and `.codex/hooks.json` load only when the project is trusted. Where trust is stored: (V), probably the user config under CODEX_HOME. The launcher must pre-seed trust or the managed layer must carry anything that has to hold.
- Containers: the docs say the Linux sandbox (bwrap/seccomp) may fail inside containers; the documented answer is to "configure the container for the isolation you need, then run Codex with `danger-full-access` inside it". They warn a malicious project can exfiltrate anything in a devcontainer, "including Codex credentials".
- **Open question that decides parity (V):** with `danger-full-access` (or no working sandbox), are `deny_read` and `permissions.*.filesystem = "deny"` still enforced? The docs tie them to the sandbox; I found no statement that Codex enforces them outside it.
- `forced_login_method` and `forced_chatgpt_workspace_id` exist (auth page); Codex logs the user out on a mismatch.

### 1.5 Hooks (question 4): https://learn.chatgpt.com/docs/hooks.md
- Events: SessionStart, SessionEnd, PreToolUse, PostToolUse, PermissionRequest, UserPromptSubmit, Stop, SubagentStart/Stop, PreCompact/PostCompact, PreModelRequest/PostModelRequest, Interrupt.
- PreToolUse/PostToolUse cover shell (matcher `Bash`), `exec_command`, `apply_patch` (matchers `apply_patch`, `Edit`, `Write`), MCP tools and other local function tools; not hosted tools such as web search. The docs call them "a useful guardrail, not a complete enforcement boundary".
- Config: `hooks.json` or inline `[hooks]` in `config.toml`, at `~/.codex/` or `<repo>/.codex/` (project ones only if trusted). SessionStart plain stdout is added as developer context. Hooks are on by default (`[features] hooks`; old alias `codex_hooks`).
- Trust: non-managed hooks "must be reviewed and trusted before they run", per hook hash, reviewed with `/hooks` in the TUI. `--dangerously-bypass-hook-trust` exists. **A headless container has no human to trust them**, so template-shipped hooks would be skipped. Managed hooks (from `requirements.toml`, `managed_dir` pointing at a directory the image provides) are "trusted by policy"; `allow_managed_hooks_only = true` ignores user and project hooks. We must install that directory.
- Our three scripts map to SessionStart, PostToolUse, SessionEnd, so event coverage is full. Stdin payload field names (`tool_name`, `tool_input`, `tool_response`) versus Codex's: (V). The scripts use `jq` on that payload.

### 1.6 Instructions, skills, commands (question 5)
- AGENTS.md: global `$CODEX_HOME/AGENTS.override.md` or `AGENTS.md`; then each directory from project root down: `AGENTS.override.md`, `AGENTS.md`, then `project_doc_fallback_filenames`. One file per directory, concatenated root to leaf. `project_doc_max_bytes` default 32 KiB. Source: https://learn.chatgpt.com/docs/agent-configuration/agents-md
- The kit already generates `template/AGENTS.md` from the same source as `CLAUDE.md` (SC-11). CLAUDE.md is not read unless listed as a fallback name; we do not need that.
- Skills: a directory with `SKILL.md` (`name`, `description` required), optional `scripts/`, `references/`, `agents/openai.yaml`. Discovery: repo `.agents/skills` from cwd up to repo root, `$HOME/.agents/skills`, admin `/etc/codex/skills`. Ours live at `.claude/skills/<n>/SKILL.md`; Codex needs `.agents/skills/<n>/SKILL.md`. `disable-model-invocation: true` (used by `setup`) has no documented equivalent; closest are `agents/openai.yaml` (V) or `[[skills.config]] enabled = false`. Source: https://learn.chatgpt.com/docs/build-skills
- Custom prompts and slash commands: not documented on the pages read. Skills are invoked with `$name` or `/skills`. We need nothing beyond skills.

### 1.7 Home and credentials (question 6): https://learn.chatgpt.com/docs/auth
- Home: `CODEX_HOME` (default `~/.codex`): `config.toml`, `auth.json`, `history.jsonl`, `log/`, profile files. The analog of `CLAUDE_CONFIG_DIR=/cli-home`.
- Credentials: `cli_auth_credentials_store = file | keyring | auto | ephemeral`. `file` writes plaintext tokens to `$CODEX_HOME/auth.json`. A container has no keyring, so `auto` falls back to file. Headless login: `codex login --device-auth` (beta; must be enabled in account or workspace settings), or copy `auth.json` from a machine with a browser.
- Refresh: when `last_refresh` is older than about 8 days Codex refreshes and writes new tokens back. The CLI-home volume must be writable and persistent per player (matches H-07).
- History: `history.persistence = save-all | none`. `features.memories` exists; Claude side sets `autoMemoryEnabled:false`, so Codex needs `features.memories = false` (effect (V)).

### 1.8 Init output without a model call (question 7)
- `codex exec --json` emits JSONL: `thread.started` first, then `turn.started`, `item.*`, `turn.completed`/`turn.failed`, `error`. **No init/config event is documented and no model-free exec.** The `system/init` line of `claude -p --output-format stream-json` (tools, MCP servers, permission mode) has no Codex twin.
- Model-free commands that exist (CLI reference; the page was partly unread): `codex mcp list --json`, `codex mcp get <n> --json`, `codex features list`, `codex execpolicy check`, `codex debug prompt-input` (renders model-visible prompt input as JSON, no turn), `codex login status`, `codex debug models`, `codex sandbox`. Flags: `--ignore-user-config` and `--ignore-rules` (exec only), `-c key=value`, `-p/--profile`.
- Gap: no documented way to ask "which hooks are loaded and trusted" or "what is the effective permission profile" without a model turn, other than reading files. Whether `debug prompt-input` shows loaded AGENTS.md and skills: (V).

## 2. PARITY TABLE

Levels: full, partial (named compensating control), none. All docs read 2026-11-09. (V) means behavior unproven on the binary.

| # | Claude-side mechanism in the kit | Codex equivalent | Level | Compensating control / note | Doc |
|---|---|---|---|---|---|
| 1 | Managed settings `/etc/claude-code/managed-settings.json`, wins over all (image/settings/managed.json) | `/etc/codex/requirements.toml` (enforced) plus `/etc/codex/managed_config.toml` (defaults, overridable in-run) | full for constrainable keys; partial for the rest | Put every must-hold rule in `requirements.toml`, never in `managed_config.toml`. Root-owned 0444, same as `contract.test.ts` checks today. | managed-configuration |
| 2 | `deny: Bash, WebFetch, WebSearch` | No shell-tool deny. `features.shell_tool` flag (V), `allowed_web_search_modes`, command `[rules] forbidden`, sandbox network off | **partial, weaker** | Codex is shell-centric: reads and edits go through the shell and `apply_patch`. Turning the shell off may leave no usable agent (V). Compensate with OS-level controls already present: internal network, no DNS, Squid allowlist (H-08), web search off. | config-reference, agent-approvals-security |
| 3 | Read/Edit/Write deny on `/cli-home/**`, `**/.credentials.json` (H-20) | `permissions.<profile>.filesystem."<path>" = "deny"`; requirements `[permissions.filesystem] deny_read` | **partial, pending (V)** | Documented enforcement is through the sandbox; under `danger-full-access` in the container it may not apply. With a shell, an unenforced deny means `cat $CODEX_HOME/auth.json` works. See section 3 and C3. | managed-configuration |
| 4 | Project path denies on kit files (`/.claude/**`, `/CLAUDE.md`, `/AGENTS.md`, `/.mcp.json`, `/player.json`, `/.gitattributes`) | Filesystem `read` rules; `.git`, `.agents`, `.codex` auto read-only in `workspace-write` | partial | The real control is the H-06 read-only kit overlay (OS bind mount) and the H-11 gate (only `memory/` and `skills/`), both CLI-independent. | agent-approvals-security |
| 5 | `defaultMode`, `blockReadsOutsideWorkingDirectories` | `sandbox_mode`, `approval_policy = "never"` for unattended, `default_permissions`, `allowed_permission_profiles` | full (config), partial (enforcement) | Same sandbox caveat as row 3. Container mounts (H-06) bound reach either way. | config-reference |
| 6 | Per-mode `--settings play.json / setup.json`, managed still wins | `-p <profile>` (`$CODEX_HOME/<profile>.config.toml`) and `-c key=value` | full | Requirements outrank both. Whether profile files can live in a read-only dir: (V). `GELDAR_MODE` goes through MCP `env`. | developer-commands |
| 7 | Hooks SessionStart, PostToolUse, SessionEnd with kit-marker guard (H-18) | Same events, `[hooks]` or `hooks.json`; managed hooks via `requirements.toml` + `managed_dir` | full (events), partial (trust) | Project hooks need `/hooks` trust, impossible headless. Ship as managed hooks with `allow_managed_hooks_only = true`. Payload adapter may be needed (V). | hooks |
| 8 | Skills `.claude/skills/<n>/SKILL.md`, `disable-model-invocation` | `.agents/skills/<n>/SKILL.md`, `$name`; admin `/etc/codex/skills` | full (content), partial (invocation flag) | `setup` must not be model-invokable: `agents/openai.yaml` policy (V) or expose `setup` only in setup mode via a mode-specific skills dir. Generate `.agents/skills` from the same source and add a drift check, as SC-11 does for instructions. | build-skills |
| 9 | MCP companions via `.mcp.json`, `GELDAR_MODE` env | `[mcp_servers.geldar-*]`, `env`, `enabled_tools`/`disabled_tools`; requirements approved list | full | Companions are stdio only, so HTTP/OAuth is off our critical path. Timeout key names for SC-71 (V). | mcp |
| 10 | `CLAUDE.md` steering | `AGENTS.md` (already generated) | full | Add a 32 KiB size assertion to the template test. | agents-md |
| 11 | `CLAUDE_CONFIG_DIR=/cli-home` volume per player and vendor (H-07) | `CODEX_HOME=/cli-home` (own volume per vendor) | full | `auth.json` is plaintext in the same volume; exposure as row 3. | auth |
| 12 | `autoMemoryEnabled:false` | `features.memories=false`, `history.persistence="none"` | partial (V) | Check default and that requirements can pin it. | config-reference |
| 13 | Pin `@anthropic-ai/claude-code@2.1.310`, `DISABLE_AUTOUPDATER=1` | `npm i -g @openai/codex@0.164.0`; `check_for_update_on_startup=false` | full | Build test shape unchanged (`codex --version`). Weekly cadence needs a bump routine (C6). | npm view, config-reference |
| 14 | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | telemetry keys off (names (V)) | partial | The Squid allowlist is the real control; Codex hosts needed are unknown (V). | not verified |
| 15 | Test hook: `claude -p --output-format stream-json` init line, no model | `codex mcp list --json`, `features list`, `execpolicy check`, `debug prompt-input`; `exec --json` needs a model | **partial** | Tests can assert servers, flags, rules and version without a model; they cannot assert effective denies or loaded hooks. Live checks stay local-only like SC-62 (D-SC-01 holds). | developer-commands, non-interactive-mode |
| 16 | Subscription login in the image | `codex login --device-auth` or copied `auth.json`; `forced_login_method="chatgpt"` | partial | Device code must be enabled on the account. | auth |
| 17 | Squid allowlist, no DNS (H-08) | unchanged | full | CLI-independent; add Codex hosts. | n/a |
| 18 | Verify gate (H-09 to H-17) | unchanged | full | CLI-independent; it is what makes weaker CLI-side controls tolerable. | n/a |

## 3. The gap that matters

Claude's safety model here: no shell for the model, tool-level path denies, OS and network controls behind them. Codex's model: a shell exists and an OS sandbox decides what it may touch. In our container the Codex sandbox may not start; the documented fallback (`danger-full-access` inside the container) leaves path protection to the container alone. The container still protects the host (H-06, H-08, H-09 to H-17 are CLI-independent). What changes is the **credential**: with Claude, `.credentials.json` is blocked from the model by tool denies; with Codex, `auth.json` sits on a filesystem the shell can read, and the docs themselves warn credentials can be exfiltrated from a devcontainer. A prompt-injected character could copy `auth.json` into `memory/` (an allowed path; the gate checks paths and modes, not content) and the launcher would push it to a public repo. Configuration alone may not reach parity here.

Options (not decided, see C3): (a) run Codex's own sandbox inside the container with the needed capabilities and prove `deny_read` with a local live check; (b) keep `auth.json` out of the session (ephemeral store, injected and removed, or token-injecting proxy; none verified for ChatGPT login); (c) a token-pattern scan of the bundle in the verify step; (d) an API key held outside the container.

## 4. Recommendation: "parity where possible" for v1

Ships (config-level, testable without a model):
1. Codex CLI in the image (variant or second CLI, C4): `@openai/codex@0.164.0` pinned, `CODEX_HOME=/cli-home`, root-owned 0444 `/etc/codex/requirements.toml` with sandbox and approval constraints, `check_for_update_on_startup=false`, web search disabled, `mcp_servers` approved list of the three companions, managed hooks with `allow_managed_hooks_only=true`, `deny_read` for `/cli-home`, `forced_login_method="chatgpt"`.
2. `template/.codex/config.toml` per SC-71 (low reasoning effort, MCP tool timeouts above 240 s, web search off); `template/.agents/skills/` generated from the same source as `.claude/skills/`; `AGENTS.md` (exists). Project config only loads if trusted, so the managed layer carries whatever must hold.
3. Hook scripts as managed copies in the image, adapter if needed, H-18 marker guard kept.
4. Model-free tests: `codex --version` equals the ARG; requirements byte-equal and unwritable; `codex mcp list --json` shows exactly the three servers; `codex features list` shows pinned flags; `codex execpolicy check` for forbidden rules; `GELDAR_MODE` reaches MCP servers only when set.
5. Launcher: `play --cli codex` selects the image and profile, mounts a vendor-specific CLI-home volume, runs `codex login --device-auth` on first use, passes `-p play|setup`.
6. Proxy: a Codex vendor allowlist file (hosts (V)).

Deferred: live proof that `deny_read` blocks the model (a Codex twin of SC-62, local only); bundle token scan unless C3 picks it; Windows-native Codex sandbox (sessions run in a Linux container anyway); Streamable HTTP/OAuth MCP (companions are stdio).

Gate: do not ship Codex before C1 and C3 are answered. If C3 has no acceptable answer, either ship as "supported with a weaker H-20, documented" or do not ship; do not claim parity.

## 5. OWNER CALLS (not decided here)

- **C1 Terms.** May players be told they can run Codex on a ChatGPT subscription for an autonomous character in a container? OpenAI's Codex docs point automation to API keys, limit ChatGPT-managed auth to trusted private infrastructure and say not to use it for public or open-source repositories (player repos are public); I could not read OpenAI's Terms. Options: get a written answer from OpenAI or counsel; require an API key; ship with a player-facing notice; do not ship Codex.
- **C2 Scope of "parity".** Accept "partial with compensating controls" in rows 2 to 4, or require full (which means not shipping until `deny_read` is proven)?
- **C3 Credential exposure.** Which of options (a) to (d) in section 3, or accept the residual risk and record it as a decision under 0007.
- **C4 One image or two.** A second CLI in the kit image (one digest, more surface, one pin set) versus a separate Codex image (two digests, `player.json` gains a field). The spec is frozen, so either needs a decision record.
- **C5 API key.** D-SC-01 says no API key in CI. Do Codex players get an API-key mode at all (OpenAI's recommended automation path, billed per use)?
- **C6 Version cadence.** Codex ships about weekly; bump the pin only per kit release, or also on security notices?
- **C7 Pin timing.** Use 0.164.0 now (eligible today), or take a newer eligible version at build time?
- **C8 `setup` skill fallback** if Codex has no invocation flag: mode-specific skills directory (my proposal) or drop the property.

## 6. Could NOT verify

- OpenAI Terms of Use, Service Terms and Usage Policies as they apply to Codex, automation, unattended runs, credential sharing and multiple accounts (403; third-party copies only).
- Whether `deny` filesystem rules and `deny_read` are enforced outside the OS sandbox (`danger-full-access`, or sandbox unavailable in the container).
- Whether bwrap works inside our container and what extra capabilities it needs.
- Whether `features.shell_tool = false` can be enforced and leaves a usable agent.
- Hook stdin payload schema versus our `jq` scripts; SessionEnd behavior in `exec` mode; managed hooks with `managed_dir` on Linux at 0.164.0 (docs describe the current release, 0.167.0 era).
- Environment scrubbing for stdio MCP servers; OAuth specifics (2.1, PKCE, DCR); MCP timeout key names.
- A `disable-model-invocation` equivalent and the `agents/openai.yaml` schema.
- Host list for the Squid allowlist; telemetry-off keys.
- Behavior at 0.164.0 specifically: I did not install or run the binary (avoided executing an unreviewed download).
- Slash commands and custom prompts; the last ~40 KB of the CLI reference and ~66 KB of the config reference were not read (tool truncation).
- Third-party blog claims (hooks guides, shared usage limits) were not relied on except where marked.

## 7. Sources (read 2026-11-09)

- https://learn.chatgpt.com/docs/config-file/config-reference
- https://learn.chatgpt.com/docs/enterprise/managed-configuration.md
- https://learn.chatgpt.com/docs/agent-approvals-security.md
- https://learn.chatgpt.com/docs/hooks.md
- https://learn.chatgpt.com/docs/extend/mcp?surface=cli
- https://learn.chatgpt.com/docs/build-skills
- https://learn.chatgpt.com/docs/agent-configuration/agents-md
- https://learn.chatgpt.com/docs/auth and https://learn.chatgpt.com/docs/auth/ci-cd-auth
- https://learn.chatgpt.com/docs/non-interactive-mode.md
- https://learn.chatgpt.com/docs/developer-commands?surface=cli
- https://github.com/openai/codex (Apache-2.0; its docs/ folder is stubs pointing to the site) and `npm view @openai/codex`
- This repo: docs/launcher-hardening.md, docs/analysis/scriptorium/work-packets.md (Waves 1, 2, 5 to 7, SC-71), image/Dockerfile, image/README.md, image/settings/managed.json
