# Egress proxy (Squid)

The session container has no route out. Its only way to a remote host is this Squid proxy, which sits on both the `inside` (internal) and `outside` networks.

Two allowlists decide what Squid forwards, both `dstdomain` (exact host names):

- `allowlist-vendor.txt` (committed here): the hosts the Claude Code CLI needs, `api.anthropic.com`, `claude.ai` and `platform.claude.com`.
- `allowlist-world.txt` (not committed): the MCP host from the player's `player.json`. The launcher writes it per session and compose mounts it.

`squid.conf` checks, in order: only ports 80 and 443 (`Safe_ports`), CONNECT only to 443 (`SSL_ports`), then the two allowlists. `http_access deny all` is last, so anything not allowed is refused with 403. Keep it last: a rule after it never runs.

The config never allows `all`, `localnet` or `localhost`. Caching is off, `via` and `forwarded_for` are removed so the request does not reveal the container.

Squid resolves names itself, so the session container needs no DNS.

To add a host: open a PR that adds the exact host to the right allowlist (no leading dot, no wildcard, no IP literal), and add a line to the test in `tests/image/proxy-config.test.ts`. Reviewers check that the host is needed by the CLI or by a configured player MCP server.

Tests: `./scriptorium.ps1 pnpm vitest run tests/image/proxy-config.test.ts` checks the policy structure and runs `squid -k parse` on the pinned image.
