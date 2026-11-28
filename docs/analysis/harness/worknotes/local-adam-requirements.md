# Local Mind for one Colo player: requirements from the economy session (2026-11-15)

Source: geldar-economy, relayed to this campaign; the owner's direction (through geldar-93) is option B: a normal Colo player whose Mind runs the `local` harness against Ollama on the desktop's GPU, over the same MCP path as the other desktop players. Facts, not decisions. Nothing here is built.

1. Endpoint: Ollama's OpenAI-style chat completions at `http://127.0.0.1:11434/v1`. Ollama binds loopback only (not to be changed), so a container reaching it through `host.docker.internal` is untested. Keep the base URL a launcher setting (`local/base-url`, HC-08c) and make `geldar-local check` (HC-13a) report whether the endpoint is reachable from where the supervisor runs. The fallback is the supervisor on the host.
2. Context: the `/v1` surface cannot set `num_ctx`. Each context size needs a model made from a Modelfile (`PARAMETER num_ctx 32768`, and 45056 as the larger). The check's context canary must verify the server did not cap it (compare `prompt_eval_count` with the estimate). One request at a time (NUM_PARALLEL 1). Models in test: qwen3:8b, llama3.1:8b, qwen2.5:14b.
3. Tool calls: native `tools` and `message.tool_calls[]`. Qwen3 emits `<think>` text: strip it from the history the loop resends, and record whether it counts against context. Arguments may arrive as an object or a JSON string: the validator accepts both (HC-07 already stringifies an object).
4. Latency: keep the history append-only, with the same system text and tool order every turn, so the server can reuse the prefix (this is also the cost lever for hosted models).

Cards touched: HC-07 (think-stripping, args), HC-10 (budget against the real context), HC-13a (reachability and canary), HC-08c (endpoint setting).
