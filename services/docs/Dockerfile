# BlammyTV docs. Next.js + Fumadocs, exported to static HTML, served by nginx.
#
# Build context is this folder (services/docs). In Coolify: build pack
# Dockerfile, Base Directory `services/docs`, Dockerfile Location `Dockerfile`.
#
# This image builds services/docs as a STANDALONE npm project rather than as a
# pnpm workspace member, the same call services/keybox makes, and for the same
# reason: with the build context scoped to this folder, the monorepo's
# pnpm-lock.yaml and pnpm-workspace.yaml are not in it, and dragging the whole
# repo in would be pure cache-busting surface for a site that depends on none
# of it.
#
# Where this DIFFERS from keybox: keybox uses `npm install`, and its own
# comment names the cost: semver-compatible releases can change what lands in
# the image without a code change, with a note to "revisit with a committed
# package-lock.json + `npm ci` if reproducibility becomes a real requirement".
# Next pulls ~330 packages against keybox's three, so that threshold is
# crossed here: package-lock.json is committed and this uses `npm ci`. Two
# builds of the same commit produce the same site.

# --- build stage ------------------------------------------------------
# bookworm-slim (glibc), not alpine (musl). Next's compiler is a native binary
# published per platform, and glibc/x64 is the well-trodden one. Alpine would
# resolve a different package.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# No phoning home from a build server.
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies first, in their own layer, so editing a page does not reinstall
# 330 packages.
COPY package.json package-lock.json ./
RUN npm ci

# Everything else. .dockerignore keeps node_modules, .next, out and .source
# out of it.
COPY . .

# A build stamp at /version.txt, so "did the deploy actually happen?" is one
# curl instead of guesswork. It exists because that question came up the first
# time a content change did not appear and there was no way to tell a failed
# redeploy from a cached page.
#
# The timestamp is the load-bearing half: it changes on every build whether or
# not anything else is wired up. SOURCE_COMMIT is a bonus, defaulted so the
# build never fails when the platform does not pass one. Coolify can supply it
# as a build argument; without it the line reads "unknown" and the timestamp
# still answers the question.
#
# Git is deliberately not consulted: the build context is services/docs alone,
# so there is no repository in here to ask.
#
# `next build` writes the whole site to out/ (next.config.mjs sets
# output: "export"). That folder is the only thing the runtime stage takes.
ARG SOURCE_COMMIT=unknown
RUN npm run build \
 && printf 'commit  %s\nbuilt   %s\n' \
      "$SOURCE_COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > out/version.txt

# --- runtime stage ----------------------------------------------------
FROM nginx:stable-alpine AS runtime

# Our server block: gzip, cache headers, a /health endpoint.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Only the built site. No node_modules, no source, no config files. Nothing
# in the web root that was not meant to be served.
COPY --from=build /app/out /usr/share/nginx/html

EXPOSE 80
# nginx:alpine's default CMD already runs nginx in the foreground.
