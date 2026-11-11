# Scriptorium work packets: wave 10 (the template becomes the standard way to play)

Part of [work-packets.md](work-packets.md) (dispatch rules 1-24). Ledger: [README.md](README.md). Written 2026-11-11 from the geldar orchestrator's brief (peer `geldar-93`) and the owner's answers recorded as decisions 55 to 58 in [worknotes/overnight-decisions.md](worknotes/overnight-decisions.md). Every Claude Code key below comes from the docs through the geldar orchestrator and is **unverified on a live build**: SC-100 proves each one before anything depends on it.

**Why.** The first sovereign Ranger ran from a throwaway brief on Opus at default effort. That costs too much. The template must be the standard way to play: plain `claude` in a player repo starts play, as a cheap orchestrator that hands in-world work to cheap workers.

**Owner requirements (from the brief).**
1. Main session is an orchestrator by default. Sonnet 5.5, reasoning effort low.
2. In-world work (gather, craft, travel, wait) goes to Haiku workers limited to the Geldar tools. Workers report in a line or two.
3. Session limit 200k tokens. The orchestrator compacts near 100k, but first checks it is safe in the world, and starts a fresh agent to resume. Workers do not compact: near 90k they reach a safe state, write a hand-off note and end; the orchestrator starts a fresh worker with the note.
4. Opening `claude` in a player repo starts play.
5. The token is never committed.
6. Memory layout and persona rules stay.

**Voice rule applies (decision 40, geldar 0014, decision 55).** Model names (`sonnet`, `haiku`) appear only in settings and agent frontmatter, never in prose. The aim is to keep the character coherent and the knowledge boundary honest (players know only what they have met; nobody is told they are watched). It is not a promise that the character cannot tell it is a program: the base model's training and its system prompt already say so, and the card does not try to hide that. Identity and persona steer how the character deals with the server, from its own nature and what it learns about its surroundings and the other players. Prose uses in-world role words: "the one who plans" and "the ones who do the legwork". No "orchestrator", "subagent", "model", "token budget" or "context" in any file a player reads. Every card's test runs `tests/template/knowledge-boundary.test.ts`.

**The backend must be real (owner, 2026-11-11).** In-world prose is a wording rule only. The model per role, the reasoning effort, the 200k window, the compaction setting and the worker tool limit are real configuration in settings and frontmatter, and each card's test asserts the setting itself (value and file), not only that the prose is clean. A card is not done if the prose is in-world but the setting is missing or wrong.

**Fan-out.** SC-100 first (a spike; no template change). Then SC-101 to SC-103 in parallel, then SC-104 and SC-105 after SC-103, SC-106 independent, SC-107 last. In-world rewrite (SC-79) lands before SC-101 or together with it (rule: shared file `template/AGENTS.md`).

**Shared files.** `template/.claude/settings.json`: SC-101, SC-103, SC-104 (serialise in that order). `template/CLAUDE.md` / `template/AGENTS.md`: SC-79, SC-102, SC-103 (serialise: SC-79 first). `template/.mcp.json`: SC-106 only.

---

## SC-100: prove the Claude Code keys (spike; main session; no coder)

Needs Claude Code 2.1.288 or later, 2.1.296 for the per-subagent window. The kit pins "at least 2.1.257" (D-SC-07), so this packet also decides the new pin and files SC-108.

On the pinned candidate version, in a scratch directory with no credentials and no player repo, with `--debug` where useful, record each answer in `worknotes/claude-keys-spike.md` with the command and output:
1. `"agent": "<name>"` makes `.claude/agents/<name>.md` the main session; `"model": "sonnet"` and `"effortLevel": "low"` in settings; `CLAUDE_CODE_EFFORT_LEVEL` precedence.
2. `initialPrompt` in the main agent's frontmatter is auto-submitted in an interactive start. If not, record the closest working alternative (`claude "<prompt>"` from the launcher).
3. `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` gives a 200k window (read `/status` or `/context`).
4. `modelSettings.<full-model-id>.autoCompactWindow: 100000` takes effect; the floor of 100000 is real; the full Sonnet 5.5 id from `/status`.
5. A subagent with `model: haiku` and `tools: mcp__geldar__*` is limited to those tools (try Bash and Edit and expect a refusal); `CLAUDE_CODE_SUBAGENT_MODEL=haiku` with `_FORCE=1` overrides a passed model.
6. A subagent cannot go below 100k for compaction; confirm there is no opt-out. The 90k stop for workers is then a prompt rule backed by a turn budget.
6b. The PreToolUse hook input carries `agent_id` and `transcript_path`, and the subagent's transcript is at `<session>/subagents/agent-<id>.jsonl` with `usage` on assistant lines (the owner's `haiku_context_cap.py` assumes this; it has a debug-log switch because "some versions" differ). Log a real hook input and confirm; confirm a deny reason is shown to the model.
7. `PreCompact` fires on `auto` and `manual`; exit 2 blocks it; stdout becomes summary instructions; it cannot stop the session or start an agent; `SessionStart` with matcher `compact` re-injects state.
8. `.mcp.json` `${GELDAR_MCP_TOKEN}` expansion in `headers`; `headersHelper` re-runs on 401 and can read a gitignored file; project servers prompt for approval interactively (the kit pre-approves, PR #40).
9. Whether the main agent can start a fresh agent for itself, or the only hard "stop and restart" is a wrapper loop in the launcher (`claude -p` in a loop keyed on a state file). Decision 57 depends on this.

**Run every item twice: inside the kit container and on a plain host** (geldar-93, 2026-11-11: Jason's Colo run was a bare host `claude -p` with `--mcp-config` and `--strict-mcp-config`, no kit, Claude Code 2.1.322, Opus default effort, 49 turns, about 4.0M cache-read tokens, about $0.90 API-equivalent; the MCP tools were deferred behind tool search once). Item 2 (`initialPrompt`) and item 6b (hook inputs) also need a headless `-p` run, where first-run screens do not appear and the interactive prompt path does not apply.

Output: the worknote, and the answers fed back into the cards below before any of them start. No commit of code.

## SC-101: default identity, settings (Haiku)

- **Branch** `scriptorium/sc-101-default-agent`. Commit: `feat: the template starts as the planner by default (sonnet, low effort)`. Depends on: SC-100, SC-79.
- **Files:** `template/.claude/settings.json` (`"agent"`, `"model": "sonnet"`, `"effortLevel": "low"`; today the template has `"model": "haiku"`), `template/.claude/agents/<planner>.md` (new; frontmatter only the fields SC-100 proved; body in-world prose from SC-102), `tests/template/settings.test.ts`, `tests/template/agent-files.test.ts` (new).
- **Test:** settings name an agent that exists; model is `sonnet` and effort `low`; the agent file's frontmatter fields are in the allowed list; allow-list still `mcp__geldar__*` (wildcard, per geldar-93: a tool rename must not break it); no model name appears outside frontmatter and settings. **Revert checks:** point `agent` at a missing file; set the model to `opus`; put "Haiku" in the body.

## SC-102: the planner's brief (Sonnet)

- **Branch** `scriptorium/sc-102-planner-brief`. Depends on: SC-79, SC-100.
- **Files:** the planner agent body, `template/AGENTS.md` (shared; one section), `tests/template/knowledge-boundary.test.ts`.
- **Content, in-world prose:** hand the legwork (gather, craft, travel, wait) to the ones who do it, one clear errand at a time; expect a line or two back; keep your own turns for deciding, talking and remembering. Before the planner's context is trimmed: be sheltered, no errand half-done, not in danger; if not safe, get safe first; then write the resume note and continue as a fresh self. The persona lines stay: never mention being an AI; you must eat, you can die.
- **Test:** the required lines exist; no meta words; the persona lines are unchanged. **Revert checks:** delete the safe-first lines; add "orchestrator".

## SC-103: the worker (Haiku)

- **Branch** `scriptorium/sc-103-worker`. Depends on: SC-100, SC-101.
- **Files:** `template/.claude/agents/<worker>.md` (new; frontmatter `model: haiku`, `tools: mcp__geldar__*`, `maxTurns` as a backstop; no Bash, no Edit), `template/.claude/settings.json` (env `CLAUDE_CODE_SUBAGENT_MODEL=haiku`, `_FORCE=1` if SC-100 proves them), `tests/template/agent-files.test.ts`.
- **Body (in-world):** do the errand, report in one or two lines. When told you are worn out, get safe where you are, then reply with what is done, what is left and the one next step. That reply is the hand-off: no file write, so the worker needs no Edit tool. The planner starts a fresh worker with that reply.
- **Test:** no tool outside `mcp__geldar__*`; `model` is `haiku`; `maxTurns` is set; the hand-off lines exist; no meta words. **Revert checks:** add `Bash` to its tools; set the model to `sonnet`; remove the hand-off lines.

## SC-104: the context meter and the compaction guard (Sonnet)

- **Branch** `scriptorium/sc-104-context-meter`. Depends on: SC-100, SC-103.
- **The existing mechanism (owner, 2026-11-11):** a PreToolUse hook meters context use and tells Haiku to stop. The owner already runs it: `~/.claude/hooks/haiku_context_cap.py`, wired globally with matcher `*`. For a subagent it reads the last API usage in that subagent's own transcript (`<session>/subagents/agent-<id>.jsonl`, found from the hook input's `agent_id` and `transcript_path`), sums `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, and when a Haiku subagent is over `HAIKU_CONTEXT_CAP` (default 90000) denies every further tool call with a stop-and-report reason. Reasons it exists: Haiku 5.5 bills 5x per request past 100k tokens, and small models degrade near the limit. It never touches the main session or non-Haiku agents, and fails open on any error, missing transcript or unknown shape. Cimmeria's `packet-coder.md` carries the matching prose rule (about 90k, `maxTurns: 90`). Reuse the design; do not rely on the owner's global copy, because it is not in any repo and the player's container does not have it.
- **Files:** `template/.claude/hooks/context-meter.sh` (bash and `jq`, decided 2026-11-11: the kit image already has both and the other template hooks use them; no Python, no new dependency; `tail` the transcript's last lines and `jq` the last assistant `usage`), `template/.claude/settings.json` (a `PreToolUse` entry, matcher `*`, that runs it; plus `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` and the launcher passes `--autocompact 100000` (the CLI accepts only `auto` or 100k to 1M; SC-100 found the `modelSettings.<id>.autoCompactWindow` settings key had no effect in a headless run, see [claude-keys-spike.md](worknotes/claude-keys-spike.md); its effect near 100k is still unproven)), `template/.claude/hooks/session-start.sh` (re-inject the planner's resume note on `compact`), `tests/template/hooks.test.ts`.
- **Behaviour (backend, must be real):**
  - Worker: soft line near 80k, hard line at 90k (both configurable by env). Soft: deny once with an in-world "you are worn out: get somewhere safe and send back your report". Hard: deny every call with the same words, no tools. The worker's reply is the hand-off.
  - Planner: its own line near 90k. Deny with "before you rest: be sheltered, no errand half-done, not in danger; if not, get safe first; then write the resume note and carry on fresh". The window setting trims at 100000 as the backstop.
  - Fails open. Reads no network. Never logs tool input.
- **The deny text is read by the player, so it is in-world** (decision 40): no "context", "token", "model", "subagent", "cap". The numbers live only in env and settings.
- **Who restarts (owner, 2026-11-11):** the planner persona starts the fresh worker when a worker hits the line, handing it the stopped worker's report as its brief. That part is settled and needs no wrapper. **Still open (decision 57):** only whether the planner can start a fresh self at its own line; SC-100 item 9. The hook gives the stop signal; it cannot start an agent.
- **Test (`hooks.test.ts`, with a fixture transcript):** a Haiku fixture over the hard line is denied and its output holds no banned word; at the soft line it is denied once; under the line it is allowed; a Sonnet main-session fixture is only touched at its own line; a missing, empty or malformed transcript is allowed; the settings entry has matcher `*` and the right command; the env values are present. **Revert checks:** raise the cap to 500000: the denial case fails; make the hook crash on bad input and exit non-zero: the fail-open case fails; put "context" in the deny text: the word check fails.

## SC-105: auto-start (Haiku)

- **Branch** `scriptorium/sc-105-auto-start`. Depends on: SC-100, SC-101.
- **Files:** the planner agent frontmatter (`initialPrompt`, if SC-100 proves it), `launcher/lib/play.sh`, `launcher/lib/play.ps1` and their tests (only if SC-100 shows `initialPrompt` fails: the launcher passes the opening prompt itself, both launchers, with the parity check of SC-77a), `tests/template/steering.test.ts`.
- **A SessionStart hook cannot send a prompt interactively** (`initialUserMessage` is `-p` only), so the hook is not the route.
- **Test:** opening prompt text names the `play` skill and uses in-world words; both launchers pass the same text. **Revert checks:** change the prompt in one launcher only: the parity check fails.

## SC-106: the token stays out of git (Haiku)

- **Branch** `scriptorium/sc-106-token`. Depends on: none.
- **Files:** `template/.mcp.json` (the header reads `${GELDAR_MCP_TOKEN}`; add `headersHelper` reading a gitignored file `.geldar-token` only if SC-100 proves it), `template/.gitignore`, `tests/template/check.ts`, `tests/template/secrets.test.ts` (new).
- **Token file format** is `GELDAR_MCP_TOKEN=<value>`. The server address shape is `https://<world host>/p/<player id>`; the template never names the host (decision 44).
- **Test:** `.gitignore` covers the token file; `.mcp.json` has no literal bearer value; a token-shaped string anywhere in `template/` fails the check. **Revert checks:** remove the gitignore line; paste a fake token into `.mcp.json`.

## SC-107: populate the real repos (owner-run; no coder)

- Depends on: SC-101 to SC-106 released in a `kit-v` candidate, and decision 56.
- `geldar-play new ag-jason-01 --persona-dir <dir>` from the new template, with the seed from geldar `docs/analysis/phase0/worknotes/ranger-personas-draft.md` (owner provisioning only, never in the Patron guide). Then the other five Rangers. The seven TNG repos wait on the owner. No push to a player repo without the owner.

## SC-108: pin the Claude Code version (Sonnet)

- Depends on: SC-100. The kit pin moves from 2.1.257 to the version SC-100 proved (2.1.296 at least if the per-subagent window is used). Files: the kit's Dockerfile pin and its digest-consistency test, the pin check, `docs/ci.md`. Revert check: lower the pin below the floor: the test fails.

## SC-109: the stop-and-restart wrapper (held on decision 57)

- Written only if SC-100 item 9 says no in-session restart exists. Scope: the launcher loops `claude -p` keyed on a state file the planner writes (`memory/journal/handoff.md` plus a `safe` flag), bounded, with a visible message per restart. Both launchers; parity check. Re-slice when decision 57 is made.

---

## The owner calls of decision 58 (cards)

### SC-79: the template's wording, in-world (Sonnet)

- **Branch** `scriptorium/sc-79-in-world`. Commit: `fix: the template says "the people who keep you" and "the tools of this world", not meta terms`. Depends on: none (lands before SC-101).
- **Files:** `template/AGENTS.md`, `template/CLAUDE.md` (the line "Try to reach anything beyond the Geldar tools", both files, byte-identical as today), `template/.claude/skills/setup/SKILL.md` ("your human" appears five times: birth is the one moment a person talks to the character, so the word becomes "the person who sets you going" and stays only inside this skill), `template/README.md` is Patron-facing and stays as is (it says Windows Terminal to the person, not to the character), `tests/template/knowledge-boundary.test.ts`, `tests/template/instructions.test.ts`.
- **Test:** the banned list gains "Your human", "your human", "Geldar tools" and "terminal" for every file the character reads (not `README.md`); the test says which file and line. **Revert checks:** put "your human" back in the setup skill; put "Geldar tools" back in `AGENTS.md`: each fails.

### SC-80: bind the host in `player.json` to `mcp_base` on every port (Sonnet; bash and PowerShell)

- **Branch** `scriptorium/sc-80-host-binding`. Commit: `fix: the player's server host must equal mcp_base on every port`. Depends on: none. Decision 42, owner answer 2026-11-11.
- **Today** `mcp_port_ok` in `launcher/lib/player.sh` (and its twin in `player.ps1`) applies the `mcp_base` scheme-and-host check only when the port is not 80 or 443. Make the scheme and host check apply on every port, with the owner-set port rule unchanged. Fails closed when `world_conf mcp_base` is missing or unparseable (the dev-world seam keeps its own path).
- **Files:** `launcher/lib/player.sh`, `launcher/lib/player.ps1`, the two launcher tests that cover mcp URL validation (find with `grep -rn mcp_port_ok tests launcher`), `docs/troubleshooting.md` if a message key text changes, `docs/threat-model.md` (one line: the accepted-risk row for decision 42 is closed).
- **Test:** a URL on 443 with a host other than `mcp_base`'s is refused (both launchers); the same host passes; a missing `mcp_base` refuses; the parity check of SC-77a still passes. **Revert checks:** restore the port-80/443 exemption: the wrong-host case fails in both launchers.

### SC-81: `--persona-dir` refuses hard links (Sonnet; bash and PowerShell)

- **Branch** `scriptorium/sc-81-hardlinks`. Commit: `fix: --persona-dir refuses hard-linked persona files`. Depends on: none. Decision 43.3, owner answer 2026-11-11.
- **Today** `persona_part` and `persona_read` in `launcher/lib/new.sh` (and `new.ps1`) refuse symlinks. Add: a persona file whose link count is above 1 is refused with the existing `persona_bad` message and a new reason `hardlink`. Bash: `stat -c %h` on Linux and `stat -f %l` on macOS, tried in that order. PowerShell: the file's `LinkType`/`Target` do not show hard links on Windows; use `fsutil hardlink list <file>` and refuse when it lists more than one name.
- **Files:** `launcher/lib/new.sh`, `launcher/lib/new.ps1`, `launcher/messages.d/*.tsv` (the `persona_bad` reason text, both twins), their tests, `docs/troubleshooting.md` (the reason, so the troubleshooting test passes).
- **Test:** a persona file with a second hard link is refused in both launchers; a normal file passes; the reason key exists in the troubleshooting guide. **Revert checks:** remove the link-count check: the refusal case fails.
