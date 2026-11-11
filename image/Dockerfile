# syntax=docker/dockerfile:1
# The Geldar kit image: the pinned Claude Code CLI plus the companion MCP servers
# (geldar-memory, geldar-git, geldar-verify) and the managed settings.
# Every pin is exact: the base by digest, the CLI by version, pnpm by version.
# Node 22.23.4 is a one-off waiver of the 14-day pin rule (decision 30, 2026-11-09): KEV-listed CVE-2026-111497 is fixed in 22.23.4. The next bump returns to the 14-day rule.
# npm and npx are removed after the CLI install: nothing runs them, and npm's bundled node-tar carried CVE-2026-59873.
# libcurl3t64-gnutls is purged (8 unfixed criticals): git here only works on local repos and bundles, never http remotes.
# The git version floor is 2.40; the build fails below it.
# Build with --target kit. The nettest stage is for tests only and is never released.
FROM node:22.23.4-trixie-slim@sha256:be1e2a3dc2c4fd68cdfadad2a696a280e0d2749098bee509230174d72fb768c6 AS deps
RUN npm install -g pnpm@12.15.0
WORKDIR /opt/geldar
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile --prod --filter "./packages/{path-rule,memory,git,verify}"

FROM node:22.23.4-trixie-slim@sha256:be1e2a3dc2c4fd68cdfadad2a696a280e0d2749098bee509230174d72fb768c6 AS kit
ARG CLAUDE_CODE_VERSION=2.1.310
RUN apt-get update \
 && apt-get install -y --no-install-recommends git jq bash ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git --version | awk '{split($3,v,"."); exit !(v[1]>2 || (v[1]==2 && v[2]>=40))}' \
 && dpkg --purge --force-depends libcurl3t64-gnutls \
 && npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
 && groupmod -n player node && usermod -l player -d /home/player -m node
COPY --from=deps /opt/geldar /opt/geldar
RUN for b in memory git verify; do \
      printf '#!/bin/sh\nexec node /opt/geldar/packages/%s/src/cli.ts "$@"\n' "$b" > /usr/local/bin/geldar-$b; \
      chmod 0755 /usr/local/bin/geldar-$b; done
COPY image/geldar-entrypoint.sh /usr/local/bin/geldar-entrypoint.sh
RUN chmod 0755 /usr/local/bin/geldar-entrypoint.sh
COPY image/settings/managed.json /etc/claude-code/managed-settings.json
COPY image/settings/play.json image/settings/setup.json /etc/geldar/settings/
RUN printf 'geldar kit\n' > /etc/geldar-kit \
 && find /etc/geldar /etc/claude-code -type f -exec chmod 0444 {} + \
 && find /etc/geldar /etc/claude-code -type d -exec chmod 0555 {} + \
 && chmod 0444 /etc/geldar-kit \
 && mkdir -p /player /cli-home && chown player:player /player /cli-home
LABEL org.opencontainers.image.source="https://github.com/SandboxServers/geldar-scriptorium"
ENV CLAUDE_CONFIG_DIR=/cli-home DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 ENABLE_CLAUDEAI_MCP_SERVERS=false ENABLE_TOOL_SEARCH=false CLAUDE_CODE_DISABLE_1M_CONTEXT=1
# The kit entrypoint seeds the player's workspace trust, then runs the base image's
# docker-entrypoint.sh. CMD is repeated because an ENTRYPOINT here resets the base image's CMD.
ENTRYPOINT ["/usr/local/bin/geldar-entrypoint.sh"]
CMD ["node"]
USER player
WORKDIR /player

FROM kit AS nettest
USER root
# The kit purged libcurl3t64-gnutls under git; this test-only stage restores it so apt stays consistent.
RUN apt-get update && apt-get install -y --no-install-recommends libcurl3t64-gnutls \
 && apt-get install -y --no-install-recommends curl bind9-dnsutils \
 && rm -rf /var/lib/apt/lists/*
USER player
