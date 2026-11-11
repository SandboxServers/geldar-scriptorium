# Scriptorium work packets: wave 11 (the long-run supervisor)

Part of [work-packets.md](work-packets.md) (dispatch rules 1-24). Ledger: [README.md](README.md). Written 2026-11-11 from the geldar orchestrator's brief (peer `geldar-93`, relaying the owner): the supervisor built for Jason's long run must be known to the campaign and become part of the launcher.

**Source (read-only, private, never published as is):** `~/.config/geldar/jason-run/` on the owner's desktop: `supervise.sh`, `status.sh`, `README-supervise.txt`, `brief-2.txt`. It loops headless `claude -p` sessions so a player can play for hours. Each session gets the persona brief plus a continuation block (the run number, the previous session's last assistant text cut to 1500 characters, and the instruction to read the journal, look, never end with a summary or ask for help, to try another way when an action fails, and to wait or sleep and try again when truly blocked). It waits 20 s between runs; backs off exponentially on fast failures (under 30 s or `is_error`) up to 15 min and writes STOP after 5 in a row; halts on a STOP file; keeps a daily USD cap (default 15, summed from `costs.csv`, sleeping to the next UTC day); and writes `status.json`, `costs.csv`, `supervisor.log` and has a `status.sh`. It holds no token; the one private value is the MCP config path, hard-coded.

**Lessons to keep:** a Haiku session ends by itself after a stuck stretch (29 turns, 2 cents), so the supervisor, not the model, gives continuity. The bare script needs Git Bash on Windows and `python -I`; the launcher must need neither. The owner's cost question (a Sonnet-low planner plus Haiku hands, still to test, versus Haiku alone, which is what runs now) is answered by a setting, not by code. The per-session restart driven by max-turns is the same stop-and-start-fresh idea as the worker meter (SC-104); the planner as root identity does not restart itself (decision 57).

## Design (decision 60)

- **Where it lives.** A launcher verb, `geldar-play run <id>`, with `run-status` and `run-stop`, in both launchers. NOT a file in `template/`: files there are published into every player repo and read by the character, and the supervisor is operator tooling on the host. (The brief said "in the template (geldar-play launcher / kit)"; this is the launcher half of that.)
- **Containment.** Each run is one full `play` cycle: prepare, a headless session in the kit container (egress proxy, path denies, the MCP token read from the player's token file by the launcher and never printed), then finish (the post-session gate and the commit). Jason's host script had none of that.
- **No new host dependency.** The host needs only what `play` needs. Parsing the `stream-json` output (cost, turns, `is_error`, last assistant text) is done by a new subcommand of the kit's existing verifier package (`geldar-verify run-summary`), run in a throwaway container on the saved stream. No Python or `jq` on the host.
- **State** lives in the player's launcher state directory (owner-only, next to `session/`), never in the player repo: `run/STOP`, `run/status.json`, `run/costs.csv`, `run/supervisor.log`, `run/session-<n>.jsonl`.
- **Config by environment**, no private paths: `GELDAR_RUN_MODEL` (empty means the template's own default planner; a value selects a single model), `GELDAR_RUN_DAILY_CAP_USD` (default 15), `GELDAR_RUN_DELAY` (default 20), `GELDAR_RUN_FAST_SEC` (default 30), `GELDAR_RUN_MAX_DELAY` (default 900), `GELDAR_RUN_MAX_TURNS` (default 300), `GELDAR_RUN_MAX_FAILS` (default 5). Model names stay in env values and the kit's settings; none appears in any text the character reads (decision 55). The cost is the API-equivalent figure the CLI reports; a subscription login is not billed per token, so the guide says so.
- **The continuation text is in-world** (decisions 40, 55): no "run", "session", "model", "prompt" or "context". Draft: `This is your waking number <N>. You have been living here a while. Last you said: "<your last words>". Read your journal first, then look around. If something does not work, read why and try another way. If you are truly stuck, wait or sleep and try again later; do not stop.` The previous words are the character's own earlier output, which is untrusted text (spec 5.15): cut to 1500 characters, control characters stripped, passed in quotes, never as an instruction line.
- **The brief** is the player's own memory (`memory/identity.md` and `memory/goals.md` are already loaded by the template's own start), so the supervisor adds only the continuation text, and the planner's `initialPrompt` does the rest. Persona briefs like Jason's `brief-2.txt` are a developer tool and are not shipped.
- **Safety.** The STOP file is checked before each run (a running session finishes first). SIGINT or SIGTERM stops after the current run. Backoff doubles on a run under `GELDAR_RUN_FAST_SEC` or with `is_error`, capped at `GELDAR_RUN_MAX_DELAY`, and `GELDAR_RUN_MAX_FAILS` in a row write STOP. The daily cap sleeps to the next UTC day. `many_players` and the other `play` refusals apply unchanged. One supervisor per player: a lock file, and a second start refuses.

## Fan-out

SC-120 (kit subcommand) and SC-121 (launcher support for a headless run) first, in parallel. SC-122 (bash) and SC-123 (PowerShell) after both, in parallel (SC-123 follows SC-122's message keys). SC-124 (docs, guide, threat model, hardening) after them. SC-125 waits on geldar PR #151.

---

## SC-120: `geldar-verify run-summary` (Sonnet; kit)

- **Branch** `scriptorium/sc-120-run-summary`. Commit: `feat: geldar-verify run-summary reads a headless stream and reports cost, turns, errors and the last words (SC-120)`. Depends on: none.
- **Files:** `packages/verify/src/` (a new `run-summary.ts` and its wiring in the CLI entry), `packages/verify/src/run-summary.test.ts`, fixtures beside the test, and `image/` only if the binary list needs a line.
- **What it does:** reads a `stream-json` transcript on stdin (JSON lines) and prints one JSON object on stdout: `{"cost": <number>, "turns": <int>, "is_error": <bool>, "last_text": "<last assistant text, at most 1500 characters, control characters removed>", "result_seen": <bool>, "tools": {"<tool name>": <count>}}`. It skips unparseable lines. It takes the last `result` line; a stream with no `result` gives `result_seen: false`, `is_error: true`, cost 0. It never prints tool input or anything but those fields. Exit 0 always; exit 2 only on a usage error.
- **Test:** fixtures for a good run, an error run, a truncated stream, a stream with ESC bytes and a 5000-character last text, an empty stream, and non-JSON noise. **Revert checks:** remove the 1500 cut; remove the control-character strip.
- **Checks:** the package's vitest run, `pnpm lint`, `pnpm lint:md`.

## SC-121: launcher support for a headless session (Sonnet; both launchers)

- **Branch** `scriptorium/sc-121-headless-session`. Commit: `feat: the launcher can run one headless session and keep its stream (SC-121)`. Depends on: none.
- **Files:** `launcher/lib/common.sh` (`harness_command` gains a mode `run`) and the PowerShell twin (`Get-HarnessCommand` in `session.ps1`), `launcher/lib/session.sh` and `session.ps1` (a non-interactive path: no TTY, the prompt passed from a file in the state directory, stdout saved to a file), the launcher tests that pin the argument list, and `docs/troubleshooting.md` for any new message key.
- **What it does:** `harness_command claude run` prints `claude --autocompact 100000 --settings <play settings> -p <prompt> --max-turns <N> --output-format stream-json --verbose` (plus `--model <m>` only when `GELDAR_RUN_MODEL` is set), with the prompt read from a file mounted read-only (not on the command line, so it never shows in a process list). The session container runs without a TTY and its stdout is written to `<state>/run/session-<n>.jsonl` with mode 0600. The `play` verb is unchanged.
- **Test:** the argument list for `run` in both launchers (parity); a test that no token or URL appears in the saved stream path or argument list; the existing `play` and `setup` argument lists unchanged. **Revert checks:** drop `--output-format` from one twin; put the prompt on the command line.

## SC-122: `geldar-play run`, `run-status`, `run-stop` (bash) (Sonnet)

- **Branch** `scriptorium/sc-122-run-bash`. Commit: `feat: geldar-play run keeps a player living for hours (bash) (SC-122)`. Depends on: SC-120, SC-121.
- **Files:** `launcher/lib/run.sh` (new), `launcher/geldar-play` (verb table, `verb_needs`), `launcher/messages.d/*.tsv` (new keys: `run_start`, `run_stop_requested`, `run_cap_reached`, `run_backoff`, `run_too_many_failures`, `run_already_running`, `run_status_none`), tests under `launcher/test/`, and `docs/troubleshooting.md` (a section per key).
- **Behaviour (the design section above, exactly):** loop: STOP check; daily cap check from `run/costs.csv` (sleep to the next UTC day); build the continuation text from the previous stream's `run-summary` (via a throwaway kit container); run one full play cycle in `run` mode; record cost and turns; backoff and failure counting; status file after every step; lock file; signal handling. `run-status` prints the status file, the last 5 cost lines and the tool-call counts of the latest stream (from `run-summary`'s `tools` map). `run-stop` creates `run/STOP`. `GELDAR_RUN_DRY=1` makes fake runs without Docker, for tests.
- **Test:** with `GELDAR_RUN_DRY=1` and a stub `run-summary`: backoff doubles and caps; five fast failures write STOP; the daily cap sleeps (inject a clock); STOP halts before the next run; a second start refuses; run numbers continue after a restart; the continuation text matches the in-world draft with the character's last words quoted, cut and stripped; no banned word in any message (the template-style word check on the message text). **Revert checks:** remove the failure cap; remove the quoting.

## SC-123: the PowerShell twin (Sonnet)

- **Branch** `scriptorium/sc-123-run-pwsh`. Same behaviour, same message keys, same tests (the launcher test harness runs both twins); the SC-77a parity check passes. Depends on: SC-120, SC-121, SC-122 (same design and message keys).

## SC-124: docs (Sonnet)

- **Branch** `scriptorium/sc-124-run-docs`. Depends on: SC-122, SC-123.
- **Files:** `template/README.md` (a short Patron section: letting a player live for hours, `geldar-play run`, `run-status`, `run-stop`, the cap, and that it costs API-equivalent money; in-world and plain, no repo name), `docs/onboarding.md`, `docs/launcher-hardening.md` (a new item: the continuation text carries the character's own earlier output, treated as untrusted; the state directory is 0700; STOP and lock files), `docs/threat-model.md` (rows), `docs/troubleshooting.md` (checked by its test), and tests (`tests/template/readme.test.ts`).
- **Test:** the README's verbs exist in the launcher; the hardening item has a hostile test (a last-words fixture with an instruction line, ESC bytes and a 10 KB tail: the continuation holds none of it uncut).

## SC-125: list the `unstick` verb (held on geldar PR #151)

- Geldar is adding an `act` verb `unstick`, an automatic unstick reflex, and real failure reasons in tool results (geldar PR #151). When it ships, list the verb in the template's play skill (and the player guide the Patron is sent to) in the character's own words. Held until geldar-93 says it landed; the template test pins the line.
