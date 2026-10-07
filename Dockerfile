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

# Cover art is baked into the image so the running container never depends on
# Open Library. `--seed` works straight from the seed book list, because there
# is no database during a build: seeded listing ids follow that list order, so
# files named after them still line up once the database is seeded.
# The fetch reaches a third-party API, so a blip must not fail the deploy —
# anything it misses falls back to generated cover art at runtime.
RUN npm --prefix server run covers -- --seed || echo "cover fetch incomplete; using generated art"

# ---- runtime ---------------------------------------------------------------
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY server/package*.json ./server/
RUN npm --prefix server ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/src ./server/src
COPY --from=build /app/server/covers ./server/covers
COPY --from=build /app/web/dist ./web/dist

# State lives in Postgres (DATABASE_URL), so the container itself is
# disposable. /data remains only for cover art fetched after deploy.
ENV SHELF_DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
