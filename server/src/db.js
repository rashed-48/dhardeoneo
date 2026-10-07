/**
 * Postgres, reached through a small adapter that keeps the call sites looking
 * the way they did under node:sqlite — `db.prepare(sql).get(...)` — so the
 * queries themselves did not have to be rewritten when the engine changed.
 *
 * Two things the adapter does:
 *
 *   - translates SQLite's positional `?` placeholders into Postgres's `$1, $2`
 *   - gives `.run()` back a `lastInsertRowid`, by appending RETURNING id
 *
 * The one unavoidable difference is that every query is now a network round
 * trip, so each of these is async where it used to be synchronous.
 */
import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

const { Pool, types } = pg;

// COUNT() is bigint and AVG() is numeric, and node-postgres returns both as
// strings to avoid precision loss. Every such value here is a count or a
// rating that the API has always sent as a number, so parse them back.
types.setTypeParser(types.builtins.INT8, (v) => (v === null ? null : Number(v)));
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));

const CONNECTION = process.env.DATABASE_URL || '';

/**
 * Checked when the app boots rather than when this module loads: the cover
 * build imports the seed for its book list and has no database at all.
 */
function requireConnection() {
  if (!CONNECTION) {
    throw new Error(
        'DATABASE_URL is not set. Point it at a Postgres database, ' +
        'for example postgres://user:password@host:5432/shelf'
    );
  }
}

/** A hosted database (Neon, Render) needs TLS; a local container does not. */
/**
 * A hosted database (Neon, Render) needs TLS; a database on this machine or
 * on a container network usually has none. An explicit sslmode in the URL
 * always wins, so a host that disagrees with the guess can say so.
 */
const DIRECT_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
  'postgres',
  'db',
]);

function sslSetting() {
  let url;
  try {
    url = new URL(CONNECTION);
  } catch {
    return { rejectUnauthorized: false };
  }
  const mode = url.searchParams.get('sslmode');
  if (mode === 'disable') return false;
  if (mode) return { rejectUnauthorized: false };
  return DIRECT_HOSTS.has(url.hostname) ? false : { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString: CONNECTION,
  ssl: sslSetting(),
  max: Number(process.env.SHELF_DB_POOL || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

/** Where to log the database without printing the password. */
export const DB_DESCRIPTION = CONNECTION.replace(/:\/\/[^@]*@/, '://***@');

/**
 * Queries inside `transaction()` must run on that transaction's own client,
 * not on an arbitrary one from the pool. Holding the client here means the
 * call sites inside a transaction stay unchanged.
 */
const activeClient = new AsyncLocalStorage();
const runner = () => activeClient.getStore() ?? pool;

/**
 * `?` → `$1, $2, …`, skipping anything inside a quoted string so a literal
 * question mark in SQL text is left alone.
 */
export function toPgSql(sql) {
  let out = '';
  let index = 0;
  let placeholder = 0;

  while (index < sql.length) {
    const char = sql[index];

    if (char === "'") {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === "'" && sql[end + 1] === "'") { end += 2; continue; }
        if (sql[end] === "'") { end += 1; break; }
        end += 1;
      }
      out += sql.slice(index, end);
      index = end;
      continue;
    }

    if (char === '?') {
      placeholder += 1;
      out += `$${placeholder}`;
      index += 1;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

/** Call sites pass parameters loose or as one array; `undefined` never binds. */
const bind = (params) => {
  const list = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return list.map((value) => (value === undefined ? null : value));
};

// app_meta is the one table without an `id`, so it must not get RETURNING id.
const RETURNS_ID = /^\s*insert\s+into\s+(?!app_meta\b)/i;

export const db = {
  prepare(sql) {
    const text = toPgSql(sql);
    const withId = RETURNS_ID.test(sql) && !/\breturning\b/i.test(sql);

    return {
      async get(...params) {
        const result = await runner().query(text, bind(params));
        return result.rows[0];
      },
      async all(...params) {
        const result = await runner().query(text, bind(params));
        return result.rows;
      },
      async run(...params) {
        const result = await runner().query(
          withId ? `${text} RETURNING id` : text,
          bind(params)
        );
        return {
          lastInsertRowid: result.rows[0]?.id,
          changes: result.rowCount ?? 0,
        };
      },
    };
  },

  async exec(sql) {
    await runner().query(sql);
  },
};

/**
 * Runs `fn` with every query inside it pinned to one client, committing if it
 * returns and rolling back if it throws.
 */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await activeClient.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone         TEXT,
  area          TEXT NOT NULL DEFAULT '',
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  bio           TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS listings (
  id            INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
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
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  status        TEXT NOT NULL DEFAULT 'available',
  created_at    TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS rentals (
  id            INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
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
  created_at    TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- Every movement of money is one immutable row. Rental balances are derived
-- from this ledger rather than stored on the rental itself.
CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
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
  created_at     TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  rental_id   INTEGER NOT NULL UNIQUE REFERENCES rentals(id) ON DELETE CASCADE,
  listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL,
  comment     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- A small internal flag lets the development seed reset demo data while the
-- normal application path keeps the payment ledger append-only.
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO app_meta (key, value) VALUES ('ledger_cleanup', '0')
  ON CONFLICT (key) DO NOTHING;

-- Brings a database created by an earlier version up to the current schema.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS cover_url TEXT NOT NULL DEFAULT '';
ALTER TABLE rentals  ADD COLUMN IF NOT EXISTS paid_at   TEXT;
ALTER TABLE rentals  ADD COLUMN IF NOT EXISTS settled_at TEXT;

CREATE INDEX IF NOT EXISTS idx_listings_owner    ON listings(owner_id);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category);
CREATE INDEX IF NOT EXISTS idx_rentals_borrower  ON rentals(borrower_id);
CREATE INDEX IF NOT EXISTS idx_rentals_owner     ON rentals(owner_id);
CREATE INDEX IF NOT EXISTS idx_rentals_listing   ON rentals(listing_id);
CREATE INDEX IF NOT EXISTS idx_reviews_listing   ON reviews(listing_id);
CREATE INDEX IF NOT EXISTS idx_payments_rental   ON payments(rental_id);
CREATE INDEX IF NOT EXISTS idx_payments_payee    ON payments(payee_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_one_success_per_kind
  ON payments(rental_id, kind) WHERE status = 'succeeded';

-- The ledger is append-only at the database level, so a bug above this layer
-- cannot rewrite history. The seed lifts the flag only to reset demo data.
CREATE OR REPLACE FUNCTION payments_immutable() RETURNS trigger AS $guard$
BEGIN
  IF (SELECT value FROM app_meta WHERE key = 'ledger_cleanup') <> '1' THEN
    RAISE EXCEPTION 'payments are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$guard$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_no_update ON payments;
CREATE TRIGGER payments_no_update BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_immutable();

DROP TRIGGER IF EXISTS payments_no_delete ON payments;
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_immutable();
`;

/** Creates the schema if it is missing. Safe to run on every boot. */
export async function initDb() {
  requireConnection();
  await pool.query(SCHEMA);
}

/** Kept for symmetry with the old driver; `undefined` never reaches a bind. */
export function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v === undefined ? null : v;
  return out;
}
