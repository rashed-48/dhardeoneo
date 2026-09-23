import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { distanceKm, CATEGORIES } from '../lib/geo.js';
import { cacheCoverFor } from '../lib/openlibrary.js';

const router = Router();

const BASE_SELECT = `
  SELECT
    l.*,
    u.name  AS owner_name,
    u.area  AS owner_area,
    u.created_at AS owner_since,
    (SELECT ROUND(AVG(r.rating), 2) FROM reviews r WHERE r.listing_id = l.id) AS rating,
    (SELECT COUNT(*)                FROM reviews r WHERE r.listing_id = l.id) AS review_count,
    (SELECT ROUND(AVG(r.rating), 2) FROM reviews r WHERE r.owner_id  = l.owner_id) AS owner_rating,
    (SELECT COUNT(*)                FROM reviews r WHERE r.owner_id  = l.owner_id) AS owner_review_count,
    (SELECT COUNT(*) FROM rentals rt
       WHERE rt.listing_id = l.id AND rt.status IN ('approved','active')) AS active_rentals
  FROM listings l
  JOIN users u ON u.id = l.owner_id
`;

/** Shapes a DB row into the object the client consumes. */
export function present(row, origin) {
  const d = distanceKm(origin, { lat: row.lat, lng: row.lng });
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    category: row.category,
    language: row.language,
    condition: row.condition,
    description: row.description,
    coverUrl: row.cover_url || '',
    pricePerDay: row.price_per_day,
    deposit: row.deposit,
    minDays: row.min_days,
    maxDays: row.max_days,
    area: row.area,
    lat: row.lat,
    lng: row.lng,
    status: row.status,
    createdAt: row.created_at,
    rating: row.rating,
    reviewCount: row.review_count,
    lentOut: row.active_rentals > 0,
    distanceKm: d == null ? null : Math.round(d * 10) / 10,
    owner: {
      id: row.owner_id,
      name: row.owner_name,
      area: row.owner_area,
      since: row.owner_since,
      rating: row.owner_rating,
      reviewCount: row.owner_review_count,
    },
  };
}

/** Cheap + well-reviewed + close ranks first; unrated books are not punished hard. */
function score(i) {
  const rating = (i.rating ?? 3.8) / 5;
  const price = 1 / (1 + i.pricePerDay / 20);
  const near = i.distanceKm == null ? 0.5 : 1 / (1 + i.distanceKm / 4);
  const trust = Math.min(i.reviewCount, 10) / 10;
  return rating * 0.4 + price * 0.25 + near * 0.25 + trust * 0.1;
}

/**
 * GET /api/listings
 * q, category, maxPrice, minRating, maxDistance, lat, lng, sort, availableOnly
 * Distance is computed in JS (dataset is small) so ranking stays exact.
 */
router.get('/', (req, res) => {
  const {
    q = '',
    category = '',
    maxPrice,
    minRating,
    maxDistance,
    lat,
    lng,
    sort = 'best',
    availableOnly,
    ownerId,
    limit,
  } = req.query;

  const where = ["l.status = 'available'"];
  const params = [];

  if (String(q).trim()) {
    where.push('(l.title LIKE ? OR l.author LIKE ? OR l.category LIKE ? OR l.description LIKE ?)');
    const like = '%' + String(q).trim() + '%';
    params.push(like, like, like, like);
  }
  if (category) {
    where.push('l.category = ?');
    params.push(String(category));
  }
  if (maxPrice) {
    where.push('l.price_per_day <= ?');
    params.push(Number(maxPrice));
  }
  if (ownerId) {
    where.push('l.owner_id = ?');
    params.push(Number(ownerId));
  }

  const rows = db.prepare(BASE_SELECT + ' WHERE ' + where.join(' AND ')).all(...params);

  const origin =
    lat && lng ? { lat: Number(lat), lng: Number(lng) } : null;

  let items = rows.map((r) => present(r, origin));

  if (minRating) items = items.filter((i) => (i.rating ?? 0) >= Number(minRating));
  if (maxDistance && origin)
    items = items.filter((i) => i.distanceKm != null && i.distanceKm <= Number(maxDistance));
  if (String(availableOnly) === 'true') items = items.filter((i) => !i.lentOut);

  const sorters = {
    price_asc: (a, b) => a.pricePerDay - b.pricePerDay,
    price_desc: (a, b) => b.pricePerDay - a.pricePerDay,
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.reviewCount - a.reviewCount,
    distance: (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
    newest: (a, b) => b.id - a.id,
    best: (a, b) => score(b) - score(a),
  };
  items.sort(sorters[sort] || sorters.best);

  if (limit) items = items.slice(0, Number(limit));

  res.json({ count: items.length, items });
});

router.get('/meta', (_req, res) => {
  const counts = db
    .prepare(
      `SELECT category, COUNT(*) AS n FROM listings WHERE status = 'available'
       GROUP BY category ORDER BY n DESC`
    )
    .all();
  const range = db
    .prepare(
      `SELECT MIN(price_per_day) AS min, MAX(price_per_day) AS max
       FROM listings WHERE status = 'available'`
    )
    .get();

  res.json({
    categories: CATEGORIES.map((name) => ({
      name,
      count: counts.find((c) => c.category === name)?.n || 0,
    })),
    priceRange: { min: range?.min ?? 0, max: range?.max ?? 100 },
    totalBooks: db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status='available'").get().n,
    totalLenders: db.prepare('SELECT COUNT(DISTINCT owner_id) AS n FROM listings').get().n,
  });
});

/**
 * GET /api/listings/cover-lookup?title=&author=
 * Finds real cover art for a book the lender is about to list and caches it
 * locally. Auth-gated because it makes an outbound request per call.
 */
router.get('/cover-lookup', requireAuth, async (req, res) => {
  const title = String(req.query.title || '').trim();
  const author = String(req.query.author || '').trim();
  const language = String(req.query.language || 'English');
  if (!title) return res.status(400).json({ error: 'Enter a title first.' });

  try {
    const hit = await cacheCoverFor(title, author, language);
    if (!hit) return res.status(404).json({ error: 'No cover found for that title.' });
    res.json(hit);
  } catch {
    res.status(502).json({ error: 'Could not reach the cover service. Try again.' });
  }
});

router.get('/:id', (req, res) => {
  const row = db.prepare(BASE_SELECT + ' WHERE l.id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Book not found.' });

  const origin =
    req.query.lat && req.query.lng
      ? { lat: Number(req.query.lat), lng: Number(req.query.lng) }
      : req.user
        ? { lat: req.user.lat, lng: req.user.lng }
        : null;

  const reviews = db
    .prepare(
      `SELECT r.*, u.name AS reviewer_name
       FROM reviews r JOIN users u ON u.id = r.reviewer_id
       WHERE r.listing_id = ? ORDER BY r.created_at DESC`
    )
    .all(row.id)
    .map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      reviewer: r.reviewer_name,
      createdAt: r.created_at,
    }));

  const busy = db
    .prepare(
      `SELECT start_date AS startDate, end_date AS endDate FROM rentals
       WHERE listing_id = ? AND status IN ('approved','active')`
    )
    .all(row.id);

  const alsoFrom = db
    .prepare(BASE_SELECT + " WHERE l.owner_id = ? AND l.id != ? AND l.status = 'available' LIMIT 4")
    .all(row.owner_id, row.id)
    .map((r) => present(r, origin));

  res.json({ listing: present(row, origin), reviews, busy, alsoFrom });
});

const clampInt = (v, lo, hi, dflt) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

const toBody = (l) => ({
  title: l.title,
  author: l.author,
  category: l.category,
  language: l.language,
  condition: l.condition,
  description: l.description,
  coverUrl: l.cover_url,
  pricePerDay: l.price_per_day,
  deposit: l.deposit,
  minDays: l.min_days,
  maxDays: l.max_days,
  area: l.area,
  lat: l.lat,
  lng: l.lng,
  status: l.status,
});

/** Guards against `javascript:` and other unexpected schemes in an img src. */
function safeCoverUrl(value) {
  const url = String(value || '').trim().slice(0, 500);
  if (!url) return '';
  if (url.startsWith('/covers/')) return url;
  if (/^https:\/\//i.test(url)) return url;
  return '';
}

function listingPayload(body, user) {
  const title = String(body.title || '').trim();
  const author = String(body.author || '').trim();
  if (!title || !author) throw new Error('Title and author are required.');

  const pricePerDay = clampInt(body.pricePerDay, 1, 10000, NaN);
  if (!Number.isFinite(pricePerDay)) throw new Error('Set a valid price per day.');

  const minDays = clampInt(body.minDays, 1, 365, 3);
  const maxDays = Math.max(minDays, clampInt(body.maxDays, 1, 365, 30));

  return {
    title,
    author,
    category: String(body.category || 'Fiction'),
    language: String(body.language || 'English'),
    condition: String(body.condition || 'Good'),
    description: String(body.description || '').slice(0, 2000),
    coverUrl: safeCoverUrl(body.coverUrl),
    pricePerDay,
    deposit: clampInt(body.deposit, 0, 100000, 0),
    minDays,
    maxDays,
    area: String(body.area || user.area || ''),
    lat: Number(body.lat ?? user.lat),
    lng: Number(body.lng ?? user.lng),
    status: body.status === 'paused' ? 'paused' : 'available',
  };
}

router.post('/', requireAuth, (req, res) => {
  let p;
  try {
    p = listingPayload(req.body || {}, req.user);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng))
    return res.status(400).json({ error: 'Pick a pickup area for this book.' });

  const info = db
    .prepare(
      `INSERT INTO listings
       (owner_id, title, author, category, language, condition, description,
        cover_url, price_per_day, deposit, min_days, max_days, area, lat, lng, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      req.user.id, p.title, p.author, p.category, p.language, p.condition,
      p.description, p.coverUrl, p.pricePerDay, p.deposit, p.minDays, p.maxDays,
      p.area, p.lat, p.lng, p.status
    );

  const row = db.prepare(BASE_SELECT + ' WHERE l.id = ?').get(info.lastInsertRowid);
  res.status(201).json({ listing: present(row, null) });
});

router.patch('/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM listings WHERE id = ?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Book not found.' });
  if (existing.owner_id !== req.user.id)
    return res.status(403).json({ error: 'This is not your listing.' });

  let p;
  try {
    p = listingPayload({ ...toBody(existing), ...(req.body || {}) }, req.user);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  db.prepare(
    `UPDATE listings SET title=?, author=?, category=?, language=?, condition=?,
       description=?, cover_url=?, price_per_day=?, deposit=?, min_days=?, max_days=?,
       area=?, lat=?, lng=?, status=? WHERE id = ?`
  ).run(
    p.title, p.author, p.category, p.language, p.condition, p.description,
    p.coverUrl, p.pricePerDay, p.deposit, p.minDays, p.maxDays, p.area, p.lat, p.lng,
    p.status, existing.id
  );

  const row = db.prepare(BASE_SELECT + ' WHERE l.id = ?').get(existing.id);
  res.json({ listing: present(row, null) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM listings WHERE id = ?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Book not found.' });
  if (existing.owner_id !== req.user.id)
    return res.status(403).json({ error: 'This is not your listing.' });

  const live = db
    .prepare(
      `SELECT COUNT(*) AS n FROM rentals
       WHERE listing_id = ? AND status IN ('requested','approved','active')`
    )
    .get(existing.id).n;
  if (live > 0)
    return res.status(409).json({ error: 'Settle the open rentals on this book first.' });

  db.prepare('DELETE FROM listings WHERE id = ?').run(existing.id);
  res.json({ ok: true });
});

export { BASE_SELECT };
export default router;
