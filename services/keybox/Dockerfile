# --- deps stage -------------------------------------------------------
# Installs node_modules in isolation so it's cached independently of any
# source-code change (only invalidated when package.json changes).
#
# Only package.json (not the monorepo's pnpm-lock.yaml/pnpm-workspace.yaml)
# is copied in — this image builds keybox as a standalone npm project, not
# as a pnpm workspace member, since the workspace's other members
# (apps/, scripts/ at the repo root) have nothing to do with this service
# and dragging the whole monorepo into the build context would be wasted
# cache-busting surface. The tradeoff: `npm install --omit=dev` resolves
# against package.json's ^-ranges at build time rather than pnpm-lock.yaml's
# pinned versions, so a dependency's semver-compatible release can change
# what lands in the image between builds without a code change here. That's
# accepted for this small, low-churn dependency set (express/stripe/
# better-sqlite3); revisit with a committed package-lock.json + `npm ci` if
# reproducibility becomes a real requirement.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# --- runtime stage ------------------------------------------------------
# better-sqlite3 ships prebuilt glibc binaries, and node:22-bookworm-slim
# is glibc-based (Debian), so `npm install` in the deps stage resolves the
# prebuild and no compiler toolchain is needed anywhere in this image.
# Evidence: the same glibc/x64/Node-22 combination resolves the prebuild
# in this repo's dev environment (no gyp step, tests green) — but the
# in-image build itself could NOT be run where this file was authored
# (registry unreachable), so WATCH THE FIRST DEPLOY LOG: if you see
# node-gyp/make output or "prebuild-install failed", add a builder stage
# with `apt-get install -y python3 make g++` before this one and copy its
# node_modules instead — never add compilers to the runtime stage itself.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV DB_PATH=/data/keybox.db
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY payloads ./payloads
COPY catalog.json ./catalog.json
COPY scripts/backup.mjs ./scripts/backup.mjs

# /data is where the sqlite db and its backups live — it must be the
# Coolify/Docker persistent volume mount point, or the key database dies
# with the container on every redeploy. The build-time chown helps the
# named-volume case (Docker copies this ownership into an empty named
# volume on first mount); it does NOT reach a root-owned bind/directory
# mount — server.js handles that at boot (see below).
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data
EXPOSE 8390

# node:*-slim has no curl, so the HEALTHCHECK uses Node's built-in fetch
# (Node 22) instead of shelling out to a tool that isn't installed.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8390/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# NO `USER node` here — intentionally. The container starts as ROOT so it
# can chown a freshly provisioned /data volume that arrived root-owned
# (Coolify does this regardless of mount type). server.js's
# ensureDataDirAndDropPrivs() fixes /data ownership and then setuid/setgid
# DROPS to the node user (uid 1000) before serving a single request — so
# runtime is still unprivileged, without needing gosu in the slim image.
CMD ["node", "src/server.js"]
