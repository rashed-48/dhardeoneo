/**
 * End-to-end API tests over HTTP.
 *
 * These boot the real entry point in a child process against a throwaway
 * database on a spare port, so they need nothing running and never touch
 * development data. The rental and payment state machine is the part of this
 * app most expensive to get wrong, so it is covered transition by transition.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(here, '..', 'src', 'index.js');

const PORT = 4300 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
/**
 * The suite creates its own database, so it never touches development data and
 * two runs cannot collide. Point SHELF_TEST_DATABASE_URL at any Postgres; the
 * default matches the container in the README.
 */
const ADMIN_URL =
  process.env.SHELF_TEST_DATABASE_URL || 'postgres://shelf:devpass@localhost:5433/shelf';
const TEST_DB = `shelf_test_${process.pid}_${Date.now().toString(36)}`;
const DATABASE_URL = new URL(ADMIN_URL);
DATABASE_URL.pathname = `/${TEST_DB}`;

const GOOD_CARD = { number: '4242424242424242', expMonth: 12, expYear: 2031, cvc: '123' };
const DECLINED_CARD = { ...GOOD_CARD, number: '4000000000000002' };
const PASSWORD = 'password123';

let server;

/** Each actor keeps its own cookie, so sessions cannot leak between them. */
class Actor {
  constructor(name) {
    this.name = name;
    this.cookie = '';
  }

  async call(route, { method = 'GET', body } = {}) {
    const res = await fetch(BASE + '/api' + route, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    for (const raw of res.headers.getSetCookie?.() ?? []) {
      if (!raw.startsWith('shelf_session=')) continue;
      const [pair] = raw.split(';');
      this.cookie = pair.endsWith('=') ? '' : pair;
      this.setCookieHeader = raw;
    }

    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    return { status: res.status, data };
  }

  login(email, password = PASSWORD) {
    return this.call('/auth/login', { method: 'POST', body: { email, password } });
  }
}

/** A date far enough ahead that it never collides with seeded bookings. */
const futureDate = (daysAhead) =>
  new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);

/**
 * Each lifecycle test publishes its own book. Competing over seeded stock makes
 * tests depend on the order they run in, which is exactly the flakiness this
 * suite exists to catch.
 */
const sessions = new Map();
async function loginAs(email) {
  if (!sessions.has(email)) {
    const actor = new Actor(email);
    const res = await actor.login(email);
    assert.equal(res.status, 200, `could not sign in as ${email}: ${JSON.stringify(res.data)}`);
    sessions.set(email, actor);
  }
  return sessions.get(email);
}

let listingCounter = 0;
async function freshListing(lender, overrides = {}) {
  const res = await lender.call('/listings', {
    method: 'POST',
    body: {
      title: `Fixture Book ${++listingCounter}`,
      author: 'Fixture Author',
      category: 'Fiction',
      pricePerDay: 10,
      deposit: 100,
      minDays: 3,
      maxDays: 30,
      area: 'Dhanmondi',
      ...overrides,
    },
  });
  assert.equal(res.status, 201, `could not publish a fixture listing: ${JSON.stringify(res.data)}`);
  return res.data.listing;
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `These tests need Postgres. Start one with:
` +
        `  docker run -d --rm --name shelf-pg -e POSTGRES_PASSWORD=devpass ` +
        `-e POSTGRES_USER=shelf -e POSTGRES_DB=shelf -p 5433:5432 postgres:17-alpine
` +
        `or set SHELF_TEST_DATABASE_URL. (${error.message})`
    );
  }
  await admin.query(`CREATE DATABASE "${TEST_DB}"`);
  await admin.end();

  server = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: DATABASE_URL.href,
      SHELF_SECRET: 'test-secret-that-is-long-enough',
      NODE_ENV: 'test',
    },
    stdio: 'pipe',
  });

  let log = '';
  server.stdout.on('data', (c) => (log += c));
  server.stderr.on('data', (c) => (log += c));

  // The first boot seeds the demo data, so allow a generous window.
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start on ${PORT}:\n${log}`);
});

after(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill();
    await exited;
  }
  // Drop the throwaway database once the server has let go of it.
  try {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    await admin.end();
  } catch {
    /* a leftover test database is not worth failing the suite over */
  }
});

test('a fresh database seeds itself so the site is never empty', async () => {
  const { status, data } = await new Actor('anon').call('/health');
  assert.equal(status, 200);
  assert.ok(data.books > 0, 'expected seeded listings');
});

test('sessions are cookie-based and invisible to JavaScript', async () => {
  const user = new Actor('ayesha');
  const { status, data } = await user.login('ayesha@shelf.app');

  assert.equal(status, 200);
  assert.ok(!('token' in data), 'no token may be returned in the body');
  assert.match(user.setCookieHeader, /HttpOnly/i);
  assert.match(user.setCookieHeader, /SameSite=Lax/i);

  const me = await user.call('/auth/me');
  assert.equal(me.data.user.email, 'ayesha@shelf.app');

  await user.call('/auth/logout', { method: 'POST' });
  assert.equal((await user.call('/auth/me')).status, 401);
});

test('signup validates its input and ignores client-supplied coordinates', async () => {
  const applicant = new Actor('applicant');
  const email = `signup-${Date.now()}@shelf.app`;

  const short = await applicant.call('/auth/signup', {
    method: 'POST',
    body: { name: 'A', email, password: 'short', area: 'Mirpur' },
  });
  assert.equal(short.status, 400);

  const nowhere = await applicant.call('/auth/signup', {
    method: 'POST',
    body: { name: 'A', email, password: PASSWORD, area: 'Atlantis' },
  });
  assert.equal(nowhere.status, 400);

  const created = await applicant.call('/auth/signup', {
    method: 'POST',
    body: { name: 'A', email, password: PASSWORD, area: 'Mirpur', lat: 0, lng: 0 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.user.area, 'Mirpur');
  assert.notEqual(created.data.user.lat, 0, 'coordinates must come from the area, not the client');
});

test('listings expose area and distance but never exact coordinates', async () => {
  const { data } = await new Actor('anon').call('/listings?lat=23.75&lng=90.37&limit=5');
  assert.ok(data.items.length > 0);
  for (const item of data.items) {
    assert.equal(item.lat, undefined);
    assert.equal(item.lng, undefined);
    assert.ok(item.area);
    assert.ok(typeof item.distanceKm === 'number');
  }
});

test('search filters and sorts hold', async () => {
  const anon = new Actor('anon');
  const origin = 'lat=23.8223&lng=90.3654';

  const cheap = await anon.call(`/listings?maxPrice=10&${origin}`);
  assert.ok(cheap.data.items.every((i) => i.pricePerDay <= 10));

  const byPrice = await anon.call(`/listings?sort=price_asc&${origin}`);
  const prices = byPrice.data.items.map((i) => i.pricePerDay);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));

  const near = await anon.call(`/listings?maxDistance=3&${origin}`);
  assert.ok(near.data.items.every((i) => i.distanceKm <= 3));

  const rated = await anon.call(`/listings?minRating=4.5&${origin}`);
  assert.ok(rated.data.items.every((i) => i.rating >= 4.5));

  const found = await anon.call('/listings?q=sapiens');
  assert.ok(found.data.items.some((i) => i.title === 'Sapiens'));
});

test('an owner sees their paused books; nobody else does', async () => {
  const owner = await loginAs('maliha@shelf.app');
  const ownerId = (await owner.call('/auth/me')).data.user.id;

  const inventory = await owner.call(`/listings?ownerId=${ownerId}&includeOwn=true`);
  const subject = inventory.data.items.find((i) => !i.lentOut);
  await owner.call(`/listings/${subject.id}`, { method: 'PATCH', body: { status: 'paused' } });

  const mine = await owner.call(`/listings?ownerId=${ownerId}&includeOwn=true`);
  assert.ok(mine.data.items.some((i) => i.id === subject.id && i.status === 'paused'));

  const publicly = await new Actor('anon').call(`/listings?ownerId=${ownerId}`);
  assert.ok(!publicly.data.items.some((i) => i.id === subject.id));

  // Another signed-in user cannot borrow the owner's view of the inventory.
  const stranger = await loginAs('imran@shelf.app');
  const peek = await stranger.call(`/listings?ownerId=${ownerId}&includeOwn=true`);
  assert.ok(peek.data.items.every((i) => i.status === 'available'));

  await owner.call(`/listings/${subject.id}`, { method: 'PATCH', body: { status: 'available' } });
});

test('listing input is allow-listed and covers must be Shelf-hosted', async () => {
  const lender = await loginAs('ayesha@shelf.app');
  const base = { title: 'Test Book', author: 'Tester', pricePerDay: 5, area: 'Mirpur' };

  for (const bad of [
    { ...base, category: 'Hacking' },
    { ...base, area: 'Narnia' },
    { ...base, language: 'Klingon' },
    { ...base, coverUrl: 'https://evil.example.com/x.jpg' },
    { ...base, coverUrl: 'javascript:alert(1)' },
  ]) {
    const res = await lender.call('/listings', { method: 'POST', body: bad });
    assert.equal(res.status, 400, `expected rejection for ${JSON.stringify(bad)}`);
  }

  const ok = await lender.call('/listings', { method: 'POST', body: base });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.listing.canDelete, true);
  // Nothing has been rented yet, so it can still be withdrawn.
  assert.equal((await lender.call(`/listings/${ok.data.listing.id}`, { method: 'DELETE' })).status, 200);
});

test('rental requests validate dates and reject impossible ones', async () => {
  const borrower = await loginAs('tanvir@shelf.app');
  const listing = (await borrower.call('/listings?limit=1')).data.items[0];

  for (const startDate of ['2026-99-99', '2026-02-30', 'not-a-date']) {
    const res = await borrower.call('/rentals', {
      method: 'POST',
      body: { listingId: listing.id, days: listing.minDays, startDate },
    });
    assert.equal(res.status, 400, `expected 400 for ${startDate}`);
  }

  const past = await borrower.call('/rentals', {
    method: 'POST',
    body: { listingId: listing.id, days: listing.minDays, startDate: '2020-01-01' },
  });
  assert.equal(past.status, 400);
  assert.match(past.data.error, /past/i);
});

test('the full rental lifecycle moves money exactly once', async () => {
  const lender = await loginAs('ayesha@shelf.app');
  const lenderId = (await lender.call('/auth/me')).data.user.id;

  const borrower = await loginAs('tanvir@shelf.app');

  const listing = await freshListing(lender);

  const requested = await borrower.call('/rentals', {
    method: 'POST',
    body: { listingId: listing.id, days: listing.minDays, startDate: futureDate(40) },
  });
  assert.equal(requested.status, 201);
  const rental = requested.data.rental;
  assert.equal(rental.total, rental.subtotal + rental.serviceFee + rental.deposit);
  assert.equal(rental.owner.phone, null, 'contact details stay hidden until acceptance');

  // Nobody may pay for a request the lender has not accepted.
  assert.equal((await borrower.call(`/rentals/${rental.id}/pay`, { method: 'POST', body: GOOD_CARD })).status, 409);

  const approved = await lender.call(`/rentals/${rental.id}/approve`, { method: 'POST' });
  assert.equal(approved.data.rental.awaitingPayment, true);
  assert.ok(approved.data.rental.owner.phone, 'contact details unlock on acceptance');

  // Handover is gated on payment.
  assert.equal((await lender.call(`/rentals/${rental.id}/handover`, { method: 'POST' })).status, 409);
  // Only the borrower pays.
  assert.equal((await lender.call(`/rentals/${rental.id}/pay`, { method: 'POST', body: GOOD_CARD })).status, 403);

  const declined = await borrower.call(`/rentals/${rental.id}/pay`, { method: 'POST', body: DECLINED_CARD });
  assert.equal(declined.status, 402);
  assert.match(declined.data.error, /declined/i);

  const paid = await borrower.call(`/rentals/${rental.id}/pay`, { method: 'POST', body: GOOD_CARD });
  assert.equal(paid.status, 200);
  assert.equal(paid.data.rental.amountPaid, rental.total);
  assert.ok(!JSON.stringify(paid.data).includes(GOOD_CARD.number), 'card number must never be stored');
  assert.ok(paid.data.rental.payments.some((p) => p.status === 'succeeded' && p.last4 === '4242'));

  assert.equal((await borrower.call(`/rentals/${rental.id}/pay`, { method: 'POST', body: GOOD_CARD })).status, 409);

  await lender.call(`/rentals/${rental.id}/handover`, { method: 'POST' });
  const returned = await lender.call(`/rentals/${rental.id}/return`, { method: 'POST' });
  assert.equal(returned.data.rental.status, 'returned');
  assert.ok(returned.data.rental.settledAt);
  assert.equal(returned.data.rental.amountRefunded, rental.deposit);
  assert.equal(returned.data.rental.payoutAmount, rental.subtotal);
  // The platform keeps precisely the service fee.
  assert.equal(
    returned.data.rental.amountPaid - returned.data.rental.amountRefunded - returned.data.rental.payoutAmount,
    rental.serviceFee
  );

  // Re-settling must not pay anyone twice.
  const resettled = await lender.call(`/rentals/${rental.id}/settle`, { method: 'POST' });
  assert.equal(resettled.data.rental.payoutAmount, rental.subtotal);
  assert.equal(resettled.data.rental.amountRefunded, rental.deposit);

  const succeeded = returned.data.rental.payments.filter((p) => p.status === 'succeeded');
  const kinds = succeeded.map((p) => p.kind);
  assert.equal(new Set(kinds).size, kinds.length, 'one succeeded row per kind');

  // A book with financial history is pinned in place.
  const removal = await lender.call(`/listings/${listing.id}`, { method: 'DELETE' });
  assert.equal(removal.status, 409);
  assert.equal((await lender.call(`/listings/${listing.id}`)).data.listing.canDelete, false);

  // Reviews only after a completed rental, and only once.
  const review = await borrower.call(`/rentals/${rental.id}/review`, {
    method: 'POST',
    body: { rating: 5, comment: 'Exactly as described.' },
  });
  assert.equal(review.status, 201);
  assert.equal((await borrower.call(`/rentals/${rental.id}/review`, { method: 'POST', body: { rating: 1 } })).status, 409);
});

test('cancelling a paid rental refunds everything and pays out nothing', async () => {
  const lender = await loginAs('ayesha@shelf.app');
  const lenderId = (await lender.call('/auth/me')).data.user.id;
  const borrower = await loginAs('tanvir@shelf.app');

  const listing = await freshListing(lender);

  const { data } = await borrower.call('/rentals', {
    method: 'POST',
    body: { listingId: listing.id, days: listing.minDays, startDate: futureDate(120) },
  });
  const rental = data.rental;

  await lender.call(`/rentals/${rental.id}/approve`, { method: 'POST' });
  await borrower.call(`/rentals/${rental.id}/pay`, { method: 'POST', body: GOOD_CARD });

  const cancelled = await borrower.call(`/rentals/${rental.id}/cancel`, { method: 'POST' });
  assert.equal(cancelled.data.rental.status, 'cancelled');
  assert.equal(cancelled.data.rental.amountRefunded, rental.total);
  assert.equal(cancelled.data.rental.payoutAmount, 0);
});

test('a rental cannot be returned unless it was handed over', async () => {
  const lender = await loginAs('ayesha@shelf.app');
  const lenderId = (await lender.call('/auth/me')).data.user.id;
  const borrower = await loginAs('tanvir@shelf.app');

  const listing = await freshListing(lender);
  const { data } = await borrower.call('/rentals', {
    method: 'POST',
    body: { listingId: listing.id, days: listing.minDays, startDate: futureDate(200) },
  });
  const rental = data.rental;

  await lender.call(`/rentals/${rental.id}/approve`, { method: 'POST' });
  assert.equal((await lender.call(`/rentals/${rental.id}/return`, { method: 'POST' })).status, 409);

  // Either side may walk away before handover.
  const withdrawn = await lender.call(`/rentals/${rental.id}/cancel`, { method: 'POST' });
  assert.equal(withdrawn.data.rental.status, 'cancelled');
  assert.equal(withdrawn.data.rental.amountRefunded, 0, 'nothing was paid, so nothing is refunded');
});

test('rental actions are scoped to the people involved', async () => {
  const lender = await loginAs('ayesha@shelf.app');
  const lenderId = (await lender.call('/auth/me')).data.user.id;
  const borrower = await loginAs('tanvir@shelf.app');
  const stranger = await loginAs('imran@shelf.app');

  const listing = await freshListing(lender);
  const { data } = await borrower.call('/rentals', {
    method: 'POST',
    body: { listingId: listing.id, days: listing.minDays, startDate: futureDate(300) },
  });
  const rental = data.rental;

  assert.equal((await stranger.call(`/rentals/${rental.id}/approve`, { method: 'POST' })).status, 403);
  assert.equal((await stranger.call(`/rentals/${rental.id}/cancel`, { method: 'POST' })).status, 403);
  assert.equal((await borrower.call(`/rentals/${rental.id}/approve`, { method: 'POST' })).status, 403);
  assert.equal((await stranger.call(`/listings/${listing.id}`, { method: 'PATCH', body: { pricePerDay: 1 } })).status, 403);

  await borrower.call(`/rentals/${rental.id}/cancel`, { method: 'POST' });
});

test('writes require a session', async () => {
  const anon = new Actor('anon');
  assert.equal((await anon.call('/listings', { method: 'POST', body: { title: 'x', author: 'y', pricePerDay: 5 } })).status, 401);
  assert.equal((await anon.call('/rentals', { method: 'POST', body: { listingId: 1, days: 3 } })).status, 401);
  assert.equal((await anon.call('/listings/cover-lookup?title=Dune')).status, 401);
});

// Kept last: it deliberately exhausts the login limiter for this address.
test('repeated failed logins are rate limited', async () => {
  const attacker = new Actor('attacker');
  let blocked = 0;

  for (let i = 0; i < 15; i++) {
    const res = await attacker.call('/auth/login', {
      method: 'POST',
      body: { email: 'nobody@shelf.app', password: 'wrong-password-attempt' },
    });
    if (res.status === 429) blocked++;
  }

  assert.ok(blocked > 0, 'expected the limiter to reject some attempts');
});
