# syntax=docker/dockerfile:1

# ---- build the SPA and fetch cover art -------------------------------------
# Covers are downloaded at build time (the build has network access) and baked
# into the image, so the running container never depends on Open Library.
FROM node:24-slim AS build
WORKDIR /app

COPY server/package*.json ./server/
COPY web/package*.json ./web/
RUN npm --prefix server ci && npm --prefix web ci

COPY server ./server
COPY web ./web

RUN npm --prefix web run build

# Seed a throwaway database purely to discover which covers to fetch, then
# drop it — the real database is created on first boot.
# `covers` reaches a third-party API, so a blip must not fail the deploy —
# anything it misses falls back to generated cover art at runtime.
RUN npm --prefix server run seed \
 && (npm --prefix server run covers || echo "cover fetch incomplete; using generated art") \
 && rm -f server/shelf.db server/shelf.db-wal server/shelf.db-shm

# ---- runtime ---------------------------------------------------------------
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY server/package*.json ./server/
RUN npm --prefix server ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/src ./server/src
COPY --from=build /app/server/covers ./server/covers
COPY --from=build /app/web/dist ./web/dist

# Writable state lives here; mount a volume on it to survive redeploys.
ENV SHELF_DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
