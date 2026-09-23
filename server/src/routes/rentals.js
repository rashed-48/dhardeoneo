import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { charge, refund, payout } from '../lib/payments.js';

const router = Router();

export const SERVICE_FEE_RATE = 0.05;
export const SERVICE_FEE_MIN = 5;

export function quote(pricePerDay, days, deposit) {
  const subtotal = pricePerDay * days;
  const serviceFee = Math.max(SERVICE_FEE_MIN, Math.round(subtotal * SERVICE_FEE_RATE));
  return { subtotal, serviceFee, deposit, total: subtotal + serviceFee + deposit };
}

const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

const RENTAL_SELECT = `
  SELECT rt.*,
         l.title, l.author, l.category, l.cover_url, l.area AS pickup_area, l.condition,
         b.name AS borrower_name, b.phone AS borrower_phone, b.area AS borrower_area,
         o.name AS owner_name,   o.phone AS owner_phone,   o.area AS owner_area,
         (SELECT COUNT(*) FROM reviews rv WHERE rv.rental_id = rt.id) AS reviewed
  FROM rentals rt
  JOIN listings l ON l.id = rt.listing_id
  JOIN users b    ON b.id = rt.borrower_id
  JOIN users o    ON o.id = rt.owner_id
`;

const presentPayment = (p) => ({
  id: p.id,
  kind: p.kind,
  amount: p.amount,
  status: p.status,
  method: p.method,
  brand: p.brand,
  last4: p.last4,
  reference: p.reference,
  failureReason: p.failure_reason,
  createdAt: p.created_at,
});

const paymentsFor = (rentalId) =>
  db
    .prepare('SELECT * FROM payments WHERE rental_id = ? ORDER BY id')
    .all(rentalId)
    .map(presentPayment);

/** Contact details only unlock once the lender has accepted. */
function present(r, viewerId, payments = []) {
  const unlocked = ['approved', 'active', 'returned'].includes(r.status);
  const isBorrower = r.borrower_id === viewerId;
  const succeeded = payments.filter((p) => p.status === 'succeeded');

  return {
    id: r.id,
    listingId: r.listing_id,
    title: r.title,
    author: r.author,
    category: r.category,
    coverUrl: r.cover_url || '',
    condition: r.condition,
    pickupArea: r.pickup_area,
    startDate: r.start_date,
    endDate: r.end_date,
    days: r.days,
    pricePerDay: r.price_per_day,
    subtotal: r.subtotal,
    serviceFee: r.service_fee,
    deposit: r.deposit,
    total: r.total,
    message: r.message,
    status: r.status,
    createdAt: r.created_at,
    reviewed: r.reviewed > 0,
    role: isBorrower ? 'borrower' : 'lender',

    paidAt: r.paid_at,
    settledAt: r.settled_at,
    // Awaiting payment is a borrower-facing state, not a separate rental status.
    awaitingPayment: r.status === 'approved' && !r.paid_at,
    amountPaid: succeeded.filter((p) => p.kind === 'rental').reduce((s, p) => s + p.amount, 0),
    amountRefunded: succeeded
      .filter((p) => p.kind === 'deposit_refund' || p.kind === 'cancellation_refund')
      .reduce((s, p) => s + p.amount, 0),
    payoutAmount: succeeded.filter((p) => p.kind === 'payout').reduce((s, p) => s + p.amount, 0),
    payments,

    borrower: {
      id: r.borrower_id,
      name: r.borrower_name,
      area: r.borrower_area,
      phone: unlocked ? r.borrower_phone : null,
    },
    owner: {
      id: r.owner_id,
      name: r.owner_name,
      area: r.owner_area,
      phone: unlocked ? r.owner_phone : null,
    },
  };
}

const recordPayment = db.prepare(
  `INSERT INTO payments
   (rental_id, payer_id, payee_id, kind, amount, status, method, brand, last4, reference, failure_reason)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`
);

const loadRental = (id) => db.prepare(RENTAL_SELECT + ' WHERE rt.id = ?').get(id);

/** POST /api/rentals — borrower requests a book for N days. */
router.post('/', requireAuth, (req, res) => {
  const { listingId, startDate, days, message = '' } = req.body || {};

  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(Number(listingId));
  if (!listing) return res.status(404).json({ error: 'Book not found.' });
  if (listing.status !== 'available')
    return res.status(409).json({ error: 'This book is not being lent right now.' });
  if (listing.owner_id === req.user.id)
    return res.status(400).json({ error: 'You cannot borrow your own book.' });

  const n = Math.round(Number(days));
  if (!Number.isFinite(n) || n < listing.min_days || n > listing.max_days)
    return res.status(400).json({
      error: `Choose between ${listing.min_days} and ${listing.max_days} days.`,
    });

  const start = isDate(startDate) ? startDate : new Date().toISOString().slice(0, 10);
  const end = addDays(start, n);

  const clash = db
    .prepare(
      `SELECT COUNT(*) AS n FROM rentals
       WHERE listing_id = ? AND status IN ('approved','active')
         AND NOT (end_date <= ? OR start_date >= ?)`
    )
    .get(listing.id, start, end).n;
  if (clash > 0)
    return res.status(409).json({ error: 'The book is already lent out for those dates.' });

  const duplicate = db
    .prepare(
      `SELECT COUNT(*) AS n FROM rentals
       WHERE listing_id = ? AND borrower_id = ? AND status = 'requested'`
    )
    .get(listing.id, req.user.id).n;
  if (duplicate > 0)
    return res.status(409).json({ error: 'You already have a pending request on this book.' });

  const q = quote(listing.price_per_day, n, listing.deposit);

  const info = db
    .prepare(
      `INSERT INTO rentals
       (listing_id, borrower_id, owner_id, start_date, end_date, days,
        price_per_day, subtotal, service_fee, deposit, total, message, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'requested')`
    )
    .run(
      listing.id, req.user.id, listing.owner_id, start, end, n,
      listing.price_per_day, q.subtotal, q.serviceFee, q.deposit, q.total,
      String(message).slice(0, 500)
    );

  res.status(201).json({ rental: present(loadRental(info.lastInsertRowid), req.user.id) });
});

/** GET /api/rentals?role=borrower|lender */
router.get('/', requireAuth, (req, res) => {
  const role = req.query.role === 'lender' ? 'lender' : 'borrower';
  const column = role === 'lender' ? 'rt.owner_id' : 'rt.borrower_id';

  const rows = db
    .prepare(RENTAL_SELECT + ` WHERE ${column} = ? ORDER BY rt.created_at DESC`)
    .all(req.user.id);

  // One query for the ledger rather than one per rental.
  const byRental = new Map();
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    db.prepare(
      `SELECT * FROM payments WHERE rental_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`
    )
      .all(...ids)
      .forEach((p) => {
        if (!byRental.has(p.rental_id)) byRental.set(p.rental_id, []);
        byRental.get(p.rental_id).push(presentPayment(p));
      });
  }

  res.json({
    items: rows.map((r) => present(r, req.user.id, byRental.get(r.id) || [])),
  });
});

/**
 * POST /api/rentals/:id/pay — borrower settles the bill once the lender accepts.
 * The card details are passed straight to the gateway; only brand and last4 persist.
 */
router.post('/:id/pay', requireAuth, (req, res) => {
  const rental = db.prepare('SELECT * FROM rentals WHERE id = ?').get(Number(req.params.id));
  if (!rental) return res.status(404).json({ error: 'Rental not found.' });
  if (rental.borrower_id !== req.user.id)
    return res.status(403).json({ error: 'Only the borrower can pay for this rental.' });
  if (rental.status !== 'approved')
    return res.status(409).json({ error: `A ${rental.status} rental cannot be paid for.` });
  if (rental.paid_at) return res.status(409).json({ error: 'This rental is already paid.' });

  const { number, expMonth, expYear, cvc } = req.body || {};
  const result = charge({
    number,
    expMonth: Number(expMonth),
    expYear: Number(expYear),
    cvc,
    amount: rental.total,
  });

  recordPayment.run(
    rental.id, rental.borrower_id, null, 'rental', rental.total,
    result.ok ? 'succeeded' : 'failed', 'card',
    result.brand, result.last4, result.reference, result.failureReason
  );

  if (!result.ok) return res.status(402).json({ error: result.failureReason });

  db.prepare("UPDATE rentals SET paid_at = datetime('now') WHERE id = ?").run(rental.id);

  const fresh = loadRental(rental.id);
  res.json({ rental: present(fresh, req.user.id, paymentsFor(rental.id)) });
});

/** POST /api/rentals/:id/review — borrower rates a finished rental. */
router.post('/:id/review', requireAuth, (req, res) => {
  const rental = db.prepare('SELECT * FROM rentals WHERE id = ?').get(Number(req.params.id));
  if (!rental) return res.status(404).json({ error: 'Rental not found.' });
  if (rental.borrower_id !== req.user.id)
    return res.status(403).json({ error: 'Only the borrower can review.' });
  if (rental.status !== 'returned')
    return res.status(409).json({ error: 'You can review once the book is returned.' });

  const rating = Math.round(Number(req.body?.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Rating must be 1 to 5.' });

  const already = db.prepare('SELECT id FROM reviews WHERE rental_id = ?').get(rental.id);
  if (already) return res.status(409).json({ error: 'You already reviewed this rental.' });

  db.prepare(
    `INSERT INTO reviews (rental_id, listing_id, owner_id, reviewer_id, rating, comment)
     VALUES (?,?,?,?,?,?)`
  ).run(
    rental.id,
    rental.listing_id,
    rental.owner_id,
    req.user.id,
    rating,
    String(req.body?.comment || '').slice(0, 800)
  );

  res.status(201).json({ ok: true });
});

const TRANSITIONS = {
  approve: { from: ['requested'], to: 'approved', by: 'lender' },
  decline: { from: ['requested'], to: 'declined', by: 'lender' },
  handover: { from: ['approved'], to: 'active', by: 'lender', requiresPaid: true },
  // Only a book that was actually handed over can come back, so every returned
  // rental is guaranteed to have been paid for and to carry a full ledger.
  return: { from: ['active'], to: 'returned', by: 'lender' },
  // Either side can walk away before handover — including a lender whose
  // borrower accepted but never paid.
  cancel: { from: ['requested', 'approved'], to: 'cancelled', by: 'either' },
};

/** Returning the book releases the deposit to the borrower and the rent to the lender. */
function settle(rental) {
  if (rental.settled_at || !rental.paid_at) return;

  if (rental.deposit > 0) {
    const r = refund({ amount: rental.deposit });
    recordPayment.run(
      rental.id, null, rental.borrower_id, 'deposit_refund', rental.deposit,
      r.ok ? 'succeeded' : 'failed', 'card', '', '', r.reference, r.failureReason
    );
  }

  // The platform keeps the service fee; the lender receives the rent.
  const p = payout({ amount: rental.subtotal });
  recordPayment.run(
    rental.id, null, rental.owner_id, 'payout', rental.subtotal,
    p.ok ? 'succeeded' : 'failed', 'transfer', '', '', p.reference, p.failureReason
  );

  db.prepare("UPDATE rentals SET settled_at = datetime('now') WHERE id = ?").run(rental.id);
}

/** Cancelling a paid rental returns everything the borrower handed over. */
function refundCancellation(rental) {
  if (!rental.paid_at || rental.settled_at) return;
  const r = refund({ amount: rental.total });
  recordPayment.run(
    rental.id, null, rental.borrower_id, 'cancellation_refund', rental.total,
    r.ok ? 'succeeded' : 'failed', 'card', '', '', r.reference, r.failureReason
  );
  db.prepare("UPDATE rentals SET settled_at = datetime('now') WHERE id = ?").run(rental.id);
}

router.post('/:id/:action', requireAuth, (req, res) => {
  const rule = TRANSITIONS[req.params.action];
  if (!rule) return res.status(404).json({ error: 'Unknown action.' });

  const rental = db.prepare('SELECT * FROM rentals WHERE id = ?').get(Number(req.params.id));
  if (!rental) return res.status(404).json({ error: 'Rental not found.' });

  const allowed =
    rule.by === 'lender' ? [rental.owner_id]
    : rule.by === 'borrower' ? [rental.borrower_id]
    : [rental.owner_id, rental.borrower_id];
  if (!allowed.includes(req.user.id))
    return res.status(403).json({ error: 'You cannot do that on this rental.' });
  if (!rule.from.includes(rental.status))
    return res.status(409).json({ error: `Cannot ${req.params.action} a ${rental.status} rental.` });
  if (rule.requiresPaid && !rental.paid_at)
    return res.status(409).json({ error: 'The borrower has not paid for this rental yet.' });

  // Approving one request auto-declines others that overlap the same dates.
  if (rule.to === 'approved') {
    db.prepare(
      `UPDATE rentals SET status = 'declined'
       WHERE listing_id = ? AND id != ? AND status = 'requested'
         AND NOT (end_date <= ? OR start_date >= ?)`
    ).run(rental.listing_id, rental.id, rental.start_date, rental.end_date);
  }

  db.prepare('UPDATE rentals SET status = ? WHERE id = ?').run(rule.to, rental.id);

  if (rule.to === 'returned') settle({ ...rental, status: 'returned' });
  if (rule.to === 'cancelled') refundCancellation(rental);

  const fresh = loadRental(rental.id);
  res.json({ rental: present(fresh, req.user.id, paymentsFor(rental.id)) });
});

export default router;
