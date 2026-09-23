import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DB_PATH, ensureDir } from './lib/paths.js';

ensureDir(path.dirname(DB_PATH));

export { DB_PATH };
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone         TEXT,
  area          TEXT NOT NULL DEFAULT '',
  lat           REAL,
  lng           REAL,
  bio           TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS listings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  author        TEXT NOT NULL,
  category      TEXT NOT NULL,
  language      TEXT NOT NULL DEFAULT 'English',
  condition     TEXT NOT NULL DEFAULT 'Good',
  description   TEXT NOT NULL DEFAULT '',
  cover_url     TEXT NOT NULL DEFAULT '',
  price_per_day INTEGER NOT NULL,
  deposit       INTEGER NOT NULL DEFAULT 0,
  min_days      INTEGER NOT NULL DEFAULT 3,
  max_days      INTEGER NOT NULL DEFAULT 30,
  area          TEXT NOT NULL,
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  status        TEXT NOT NULL DEFAULT 'available',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rentals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id    INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  borrower_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  days          INTEGER NOT NULL,
  price_per_day INTEGER NOT NULL,
  subtotal      INTEGER NOT NULL,
  service_fee   INTEGER NOT NULL,
  deposit       INTEGER NOT NULL,
  total         INTEGER NOT NULL,
  message       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'requested',
  paid_at       TEXT,
  settled_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every movement of money is one immutable row. Rental balances are derived
-- from this ledger rather than stored on the rental itself.
CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  rental_id      INTEGER NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  payer_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  payee_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  status         TEXT NOT NULL,
  method         TEXT NOT NULL DEFAULT 'card',
  brand          TEXT NOT NULL DEFAULT '',
  last4          TEXT NOT NULL DEFAULT '',
  reference      TEXT NOT NULL DEFAULT '',
  failure_reason TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rental_id   INTEGER NOT NULL UNIQUE REFERENCES rentals(id) ON DELETE CASCADE,
  listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL,
  comment     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_listings_owner    ON listings(owner_id);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category);
CREATE INDEX IF NOT EXISTS idx_rentals_borrower  ON rentals(borrower_id);
CREATE INDEX IF NOT EXISTS idx_rentals_owner     ON rentals(owner_id);
CREATE INDEX IF NOT EXISTS idx_rentals_listing   ON rentals(listing_id);
CREATE INDEX IF NOT EXISTS idx_reviews_listing   ON reviews(listing_id);
CREATE INDEX IF NOT EXISTS idx_payments_rental   ON payments(rental_id);
CREATE INDEX IF NOT EXISTS idx_payments_payee    ON payments(payee_id);
`);

/** Brings a database created by an earlier version up to the current schema. */
function addColumn(table, column, definition) {
  const exists = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumn('listings', 'cover_url', "TEXT NOT NULL DEFAULT ''");
addColumn('rentals', 'paid_at', 'TEXT');
addColumn('rentals', 'settled_at', 'TEXT');

/** node:sqlite refuses `undefined`; normalise params before binding. */
export function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v === undefined ? null : v;
  return out;
}
