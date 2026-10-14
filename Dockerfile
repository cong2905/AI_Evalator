# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
# Debian rather than Alpine: better-sqlite3 is a native module and its
# prebuilt binaries are glibc-based.
FROM node:22-slim AS build
WORKDIR /app

# Build tools, in case no prebuilt better-sqlite3 binary matches this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci

COPY . .
RUN npm run build -w client

# Drop dev dependencies, but keep tsx — the server runs TypeScript directly.
RUN npm prune --omit=dev \
  && npm install --no-save tsx@^4.19.2

# ---- runtime --------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
# The volume mounted at /data is the only writable, persistent path.
ENV DB_PATH=/data/app.db

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared ./shared
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist

# Don't run as root.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3001
CMD ["node_modules/.bin/tsx", "server/src/index.ts"]
