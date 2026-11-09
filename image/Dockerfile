# syntax=docker/dockerfile:1
# The Geldar kit image: the pinned Claude Code CLI plus the companion MCP servers
# (geldar-memory, geldar-git, geldar-verify) and the managed settings.
# Every pin is exact: the base by digest, the CLI by version, pnpm by version.
# The git version floor is 2.40; the build fails below it.
# Build with --target kit. The nettest stage is for tests only and is never released.
FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS deps
RUN npm install -g pnpm@12.15.0
WORKDIR /opt/geldar
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile --prod --filter "./packages/{path-rule,memory,git,verify}"

FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS kit
ARG CLAUDE_CODE_VERSION=2.1.310
RUN apt-get update \
 && apt-get install -y --no-install-recommends git jq bash ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git --version | awk '{split($3,v,"."); exit !(v[1]>2 || (v[1]==2 && v[2]>=40))}' \
 && npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
 && groupmod -n player node && usermod -l player -d /home/player -m node
COPY --from=deps /opt/geldar /opt/geldar
RUN for b in memory git verify; do \
      printf '#!/bin/sh\nexec node /opt/geldar/packages/%s/src/cli.ts "$@"\n' "$b" > /usr/local/bin/geldar-$b; \
      chmod 0755 /usr/local/bin/geldar-$b; done
COPY image/settings/managed.json /etc/claude-code/managed-settings.json
COPY image/settings/play.json image/settings/setup.json /etc/geldar/settings/
RUN printf 'geldar kit\n' > /etc/geldar-kit \
 && find /etc/geldar /etc/claude-code -type f -exec chmod 0444 {} + \
 && find /etc/geldar /etc/claude-code -type d -exec chmod 0555 {} + \
 && chmod 0444 /etc/geldar-kit \
 && mkdir -p /player /cli-home && chown player:player /player /cli-home
LABEL org.opencontainers.image.source="https://github.com/SandboxServers/geldar-scriptorium"
ENV CLAUDE_CONFIG_DIR=/cli-home DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
USER player
WORKDIR /player

FROM kit AS nettest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl bind9-dnsutils \
 && rm -rf /var/lib/apt/lists/*
USER player
