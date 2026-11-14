# Direct ChatGPT subscription provider

Date: 2026-11-13. Owner request: make Scriptorium compatible with ChatGPT subscriptions as well as Claude for player minds (frozen spec §5.15).

Add `chatgpt` as a persistent-player harness using OpenAI's documented [OSS plan-usage flow](https://developers.openai.com/siwc/token-sharing-open-source). Keep Claude as default and keep the Codex CLI hold (D-SC-08, overnight decision 46). The direct provider addresses that hold's credential concern by exposing only bounded memory/skill tools and the existing world/git MCP services; the character has no shell or arbitrary file/URL tool. It does not claim Codex parity or approval for a remotely hosted paid app.

Use per-player vendor credential volumes, PKCE/state/nonce with signed ID validation, explicit plan scope checks, atomic token rotation and a refresh lock. No real model calls or login in CI. Persistent players require seeded personas; model choices come from the connected account. Dollar pricing is unavailable for this subscription path and must not be invented. The [setup guide](../chatgpt.md) records usage-limit controls and the remaining local live acceptance step.
