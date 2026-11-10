# Egress proxy (Squid)

The session container has no route out. Its only way to a remote host is this Squid proxy, which sits on both the `inside` (internal) and `outside` networks.

Two allowlists decide what Squid forwards, both `dstdomain` (exact host names):

- `allowlist-vendor.txt` (committed here): the hosts the Claude Code CLI needs, `api.anthropic.com`, `claude.ai` and `platform.claude.com`.
- `allowlist-world.txt` (not committed): the MCP host from the player's `player.json`. The launcher writes it per session and compose mounts it.
- `allowlist-world-ports.txt` (the `world_port` ACL, not committed): the effective port of the MCP URL. The launcher writes it into the player's `pub/` folder and sets `GELDAR_WORLD_PORTS` to it. Compose mounts `world-ports-default.txt` (committed here, holds `443`) when `GELDAR_WORLD_PORTS` is unset.

`squid.conf` checks, in order: ports 80 and 443 (`Safe_ports`) or the world port (`world_port`); CONNECT to port 80 is refused outright (`port_80`); CONNECT only to 443 (`SSL_ports`) or the world port; then the two allowlists. The launcher accepts a non-default port only when it equals `mcp_port`, so that is the only non-default port Squid receives. `http_access deny all` is last, so anything not allowed is refused with 403. Keep it last: a rule after it never runs.

The config never allows `all`, `localnet` or `localhost`. Caching is off, `via` and `forwarded_for` are removed so the request does not reveal the container.

Squid resolves names itself, so the session container needs no DNS.

To add a host: open a PR that adds the exact host to the right allowlist (no leading dot, no wildcard, no IP literal), and add a line to the test in `tests/image/proxy-config.test.ts`. Reviewers check that the host is needed by the CLI or by a configured player MCP server.

Tests: `./scriptorium.ps1 pnpm vitest run tests/image/proxy-config.test.ts` checks the policy structure and runs `squid -k parse` on the pinned image.
