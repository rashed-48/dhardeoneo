import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { db, initDb, pool, DB_DESCRIPTION } from './db.js';
import { seed } from './seed.js';
import { attachUser } from './lib/auth.js';
import {
  COVERS_DIR, BUNDLED_COVERS_DIR, WEB_DIST, IS_PRODUCTION, ensureDir,
} from './lib/paths.js';
import { AREAS, CATEGORIES } from './lib/geo.js';
import authRoutes from './routes/auth.js';
import listingRoutes from './routes/listings.js';
import rentalRoutes from './routes/rentals.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);

// A fresh host starts with an empty volume; without this the site would come
// up with no books at all.
async function seedIfEmpty() {
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) return;
  console.log('[shelf] Empty database — seeding demo data.');
  await seed();
}

/**
 * Cover art ships inside the image. When COVERS_DIR points at a mounted volume
 * instead, copy the bundled files across on first boot so the seeded books keep
 * their jackets and anything fetched later persists alongside them.
 */
function hydrateCovers() {
  ensureDir(COVERS_DIR);
  if (COVERS_DIR === BUNDLED_COVERS_DIR || !fs.existsSync(BUNDLED_COVERS_DIR)) return;

  let copied = 0;
  for (const file of fs.readdirSync(BUNDLED_COVERS_DIR)) {
    const target = path.join(COVERS_DIR, file);
    if (fs.existsSync(target)) continue;
    fs.copyFileSync(path.join(BUNDLED_COVERS_DIR, file), target);
    copied++;
  }
  if (copied) console.log(`[shelf] Copied ${copied} bundled cover(s) to ${COVERS_DIR}.`);
}

/**
 * Links listings to cover files that exist on disk but are not recorded yet.
 * The seed does this too, but it only runs once — this also repairs a database
 * that predates the cover art, or one seeded before a volume was hydrated.
 */
async function reattachCovers() {
  const orphans = await db.prepare("SELECT id FROM listings WHERE cover_url = ''").all();
  if (orphans.length === 0) return;

  const update = db.prepare('UPDATE listings SET cover_url = ? WHERE id = ?');
  let linked = 0;
  for (const { id } of orphans) {
    if (!fs.existsSync(path.join(COVERS_DIR, `${id}.jpg`))) continue;
    await update.run(`/covers/${id}.jpg`, id);
    linked++;
  }
  if (linked) console.log(`[shelf] Linked ${linked} listing(s) to their cover art.`);
}

// Order matters: covers must be in place before the seed looks for them.
hydrateCovers();
// The schema has to exist before anything queries it.
await initDb();
await seedIfEmpty();
await reattachCovers();

// Hosts terminate TLS upstream, so trust their forwarding headers.
app.set('trust proxy', 1);

app.use(
  helmet({
    // The SPA is same-origin, but it pulls fonts from Google and cover art
    // from this same host, so the default policy is too tight.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: IS_PRODUCTION ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  })
);
app.use(compression());

// In production the SPA is served from this origin, so nothing cross-origin is
// needed. In development Vite runs on :5173 and does need it.
if (!IS_PRODUCTION) app.use(cors());

app.use(express.json({ limit: '1mb' }));
app.use(attachUser);

// Cover art downloaded by `npm run covers`, served straight off disk. The 404
// below stops a missing image falling through to the SPA and returning HTML.
app.use('/covers', express.static(COVERS_DIR, { maxAge: '7d' }));
app.use('/covers', (_req, res) => res.status(404).json({ error: 'No such cover.' }));

app.get('/api/health', async (_req, res) => {
  // The health check doubles as a database probe, so a failure here should
  // report unhealthy rather than hang the platform's checker.
  try {
    const { n } = await db
      .prepare("SELECT COUNT(*) AS n FROM listings WHERE status='available'")
      .get();
    res.json({
      ok: true,
      service: 'shelf',
      env: IS_PRODUCTION ? 'production' : 'development',
      books: n,
    });
  } catch {
    res.status(503).json({ ok: false, service: 'shelf', error: 'database unavailable' });
  }
});
app.get('/api/config', (_req, res) =>
  res.json({ areas: AREAS, categories: CATEGORIES, currency: '৳' })
);

app.use('/api/auth', authRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/rentals', rentalRoutes);

// An unknown /api path is an error; anything else may be a client-side route.
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

const indexHtml = path.join(WEB_DIST, 'index.html');
const hasWebBuild = fs.existsSync(indexHtml);

if (hasWebBuild) {
  // Hashed asset filenames can be cached hard; index.html must not be.
  app.use(express.static(WEB_DIST, { maxAge: '1y', index: false }));
  app.get('*', (_req, res) =>
    res.sendFile(indexHtml, { headers: { 'Cache-Control': 'no-cache' } })
  );
} else {
  app.use((_req, res) =>
    res.status(404).json({
      error: IS_PRODUCTION
        ? 'The web build is missing. Run `npm run build` before starting.'
        : 'Not found. In development the UI is served by Vite on :5173.',
    })
  );
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something broke on our side.' });
});

const server = app.listen(PORT, () => {
  console.log(`[shelf] listening on :${PORT}`);
  console.log(`[shelf] database ${DB_DESCRIPTION}`);
  console.log(`[shelf] covers   ${COVERS_DIR}`);
  console.log(`[shelf] web      ${hasWebBuild ? WEB_DIST : 'served by Vite (dev)'}`);
});

/**
 * Hosts send SIGTERM on every deploy and whenever an idle instance is stopped.
 * Exiting on the spot drops whatever is in flight: Postgres rolls back an
 * unfinished transaction cleanly, so the ledger stays correct, but someone who
 * pressed Pay gets a dead connection and no answer about their money.
 *
 * So: stop taking new work, let the current requests finish, then close the
 * pool. Idle keep-alive sockets have to be closed explicitly or they hold the
 * server open until they time out.
 */
const GRACE_MS = Number(process.env.SHELF_SHUTDOWN_GRACE_MS || 10_000);
let closing = false;

async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[shelf] ${signal} — finishing in-flight requests`);

  // A request that never finishes must not block a deploy indefinitely.
  const giveUp = setTimeout(() => {
    console.warn(`[shelf] still busy after ${GRACE_MS}ms — exiting anyway`);
    process.exit(1);
  }, GRACE_MS);
  giveUp.unref();

  server.closeIdleConnections();
  server.close(async () => {
    try {
      await pool.end();
    } catch {
      /* already gone */
    }
    clearTimeout(giveUp);
    console.log('[shelf] stopped cleanly');
    process.exit(0);
  });
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => shutdown(signal));
}
