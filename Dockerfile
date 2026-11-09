# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
# Debian rather than Alpine: libSQL's native module ships glibc prebuilds
# (@libsql/linux-x64-gnu), so no compiler is needed here — on musl npm would
# reach for the musl build instead, but the prebuild set is smaller.
FROM node:22-slim AS build
WORKDIR /app

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
# Used only when TURSO_DATABASE_URL is unset. On a host with a real volume
# mounted at /data this is the database; on a host with no persistent disk,
# set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN and this is ignored.
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
