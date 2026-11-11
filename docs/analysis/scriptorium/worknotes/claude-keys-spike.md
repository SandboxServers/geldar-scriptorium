# SC-100: Claude Code keys spike (host and kit)

Run 2026-11-11 on the owner's Windows desktop, Claude Code 2.1.322, headless `claude -p` in a scratch project outside the repo (a `planner` main agent, a `worker` Haiku agent, hook scripts that log their stdin). About $1.40 of model use in all. Kit half run the same day in the kit image (Claude Code 2.1.310, Node 22.23.4, jq 1.7.1, no Python) with a throwaway copy of the ag-jason-01 login volume, deleted afterwards (about $1.15 more).

## Proven on the host

| Card item | Result |
|---|---|
| 1. `"agent": "<name>"` in `.claude/settings.json` makes the agent the main session | Yes. PreToolUse input has `agent_type: "planner"`; init model `claude-sonnet-5-5`. |
| 1. `model` and `effortLevel` | Yes. Hook inputs carry `effort: {"level":"low"}` for the planner and the worker. |
| 2. `initialPrompt` in the main agent's frontmatter | Fires in headless `-p` too (the reply began with its text). It competes with the real task: in one run the planner answered only the initial prompt and stopped. Keep it short and make it the play instruction itself. **Interactive start not tested** (needs a TTY). |
| 3. `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` | Yes. `modelUsage.contextWindow` goes 1,000,000 to 200,000. |
| 5. Worker `model: haiku`, `tools: Read` | Yes. The Haiku worker had only Read and said it had no Bash. The `Task`/`Agent` tool name is `Task` in init. |
| 6b. Hook input for the meter | Yes. A subagent's PreToolUse input has `agent_id`, `agent_type`, `transcript_path` (the main session's). Its own transcript is `<session dir>/subagents/agent-<id>.jsonl` with `usage` on assistant lines (verified: Haiku, 3,376 tokens). Main-session calls carry no `agent_id`. |
| SessionStart | Fires with `source: "startup"`. |

## Not working or unproven

- **`modelSettings.<model-id>.autoCompactWindow`** in settings: accepted without error, but with 50000 set, context grew to about 165k with no compaction and no PreCompact event (headless). Do not rely on it.
- **`--autocompact <auto|tokens>`**: exists. Valid values are `auto` or 100k to 1M; the CLI refuses 20000. This is the compaction knob to use, passed by the launcher. Its effect was not observed: two long runs ended early (the Read tool refuses files over its size limit and the model stopped), so context never passed about 50k at the set line. **Unproven that it compacts near 100k.**
- **PreCompact and SessionStart `compact`**: never fired (no compaction happened). Unproven.
- **Subagent compaction opt-out and the `autoCompactWindow` frontmatter key**: not tested.
- **`.mcp.json` token expansion and `headersHelper`**: not tested.
- **Planner restarting itself (decision 57)**: not tested.

## Findings that change the cards

- No `jq` on the host's Git Bash. The template's hooks (and the SC-104 meter) need `jq`; the kit image has it, a plain host may not. Decide: the meter fails open without `jq`, so on a host it silently does nothing. Either require `jq` in the guide, or use a different parser for the meter.
- The owner's account connectors leaked into a worker's read result (a connector instruction text). The kit's connectors-off setting is needed on a host run too (`--strict-mcp-config` hid them in Jason's run).
- The planner should not rely on a settings key for trimming: the meter (PreToolUse) is the proven guard.


## Kit image results (Claude Code 2.1.310)

- Same as the host on agent, `model`, effort `low`, worker tools (Read only), `agent_id` in subagent hook inputs, 200k window with `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` (the image's own ENV does not set it; the launcher or the template must).
- **`--autocompact 100000` works.** One automatic compaction: PreCompact fired (`trigger: "auto"`), the SessionStart hook fired again with `source: "compact"`, and the result event carried a `compact_boundary` (147,439 tokens before, 36,723 after). The settings key `modelSettings.<id>.autoCompactWindow` did not do this on the host; use the flag.
- **It overshoots.** Context sat at about 111k for seven messages and was compacted only when it reached about 147k. One Read result adds about 25k at a time, so a line "near 100k" can fire well past 100k. The planner's meter line should be about 80k, not 90k, and the worker's soft line about 70k.
- `initialPrompt` fired in the kit as well (headless). Interactive still untested.
- The kit's Read tool returned about 55% of a single-line 50 KB file even with `allow_large`; irrelevant to play, but it made the compaction test need several files.

## Still open

Interactive `initialPrompt`; `.mcp.json` `${GELDAR_MCP_TOKEN}` expansion and `headersHelper` in the kit; a subagent's own compaction and the `autoCompactWindow` frontmatter key (needs 2.1.296 or later, the kit has 2.1.310: SC-108 decides the pin); decision 57 (can the planner start a fresh self).

## Left to do (superseded by the list above)

Kit-container run of every item above; interactive `initialPrompt`; a compaction run that genuinely crosses 100k (read many files under the Read limit, or feed it with a hook); `.mcp.json` expansion; decision 57.
