# syntax=docker/dockerfile:1
# TEST ONLY. The stub image variant: the kit image with the scripted stub-cli in place of
# the real claude CLI. It is never published and never a release target.
# Build: docker build -f image/stub.Dockerfile --build-arg KIT_BASE=<kit image> .
# KIT_BASE has no default, so the build fails without it.
ARG KIT_BASE
FROM ${KIT_BASE}
USER root
RUN corepack enable && corepack prepare pnpm@12.15.0 --activate
WORKDIR /opt/geldar-stub
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile --prod --filter "./packages/stub-cli..." \
 && printf '#!/bin/sh\nexec node /opt/geldar-stub/packages/stub-cli/src/cli.ts "$@"\n' > /usr/local/bin/claude \
 && chmod 0755 /usr/local/bin/claude
USER player
WORKDIR /player
