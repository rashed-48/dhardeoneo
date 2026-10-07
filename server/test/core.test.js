import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Importing the rental module opens SQLite. Keep test state out of the repository.
process.env.SHELF_DB = path.join(os.tmpdir(), `shelf-core-test-${process.pid}.db`);

const { charge, luhnValid } = await import('../src/lib/payments.js');
const { distanceKm } = await import('../src/lib/geo.js');
const { quote, isDate } = await import('../src/routes/rentals.js');

test('payment simulator accepts and rejects its documented cards', () => {
  const futureYear = new Date().getUTCFullYear() + 1;
  assert.equal(luhnValid('4242 4242 4242 4242'), true);
  assert.equal(charge({ number: '4242 4242 4242 4242', expMonth: 12, expYear: futureYear, cvc: '123', amount: 100 }).ok, true);
  assert.equal(charge({ number: '4000 0000 0000 0002', expMonth: 12, expYear: futureYear, cvc: '123', amount: 100 }).ok, false);
});

test('quotes preserve the five-percent fee with its minimum', () => {
  assert.deepEqual(quote(10, 1, 25), { subtotal: 10, serviceFee: 5, deposit: 25, total: 40 });
  assert.deepEqual(quote(100, 3, 0), { subtotal: 300, serviceFee: 15, deposit: 0, total: 315 });
});

test('dates must be real ISO calendar dates', () => {
  assert.equal(isDate('2026-02-28'), true);
  assert.equal(isDate('2026-02-29'), false);
  assert.equal(isDate('2026-99-99'), false);
  assert.equal(isDate('not-a-date'), false);
});

test('distance is zero at the same location and null without an origin', () => {
  assert.equal(distanceKm(null, { lat: 23.7, lng: 90.4 }), null);
  assert.equal(distanceKm({ lat: 23.7, lng: 90.4 }, { lat: 23.7, lng: 90.4 }), 0);
});

const { shouldRefresh, SESSION_LIMITS } = await import('../src/lib/auth.js');
const { idleWindowMs, absoluteMaxMs, refreshAfterMs } = SESSION_LIMITS;

test('a fresh session is not reissued on every request', () => {
  const now = Date.now();
  const session = { startedAt: now, expiresAt: now + idleWindowMs };
  assert.equal(shouldRefresh(session, now), false);
  assert.equal(shouldRefresh(session, now + refreshAfterMs - 1000), false);
});

test('an active session slides once past the halfway point', () => {
  const now = Date.now();
  const session = { startedAt: now, expiresAt: now + idleWindowMs };
  assert.equal(shouldRefresh(session, now + refreshAfterMs), true);
  assert.equal(shouldRefresh(session, now + idleWindowMs - 1000), true);
});

test('sliding stops at the absolute cap and after it has lapsed', () => {
  const now = Date.now();
  const old = now - absoluteMaxMs - 1000;
  assert.equal(shouldRefresh({ startedAt: old, expiresAt: now + 60_000 }, now), false);
  // Already expired: nothing to extend.
  assert.equal(shouldRefresh({ startedAt: now, expiresAt: now - 1 }, now), false);
});
