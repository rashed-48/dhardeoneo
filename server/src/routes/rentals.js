import { asyncRouter } from '../lib/router.js';
import { db, transaction } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { charge, refund, payout } from '../lib/payments.js';
import { rateLimit } from '../lib/rateLimit.js';

const router = asyncRouter();

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

export const isDate = (value) => {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

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

const paymentsFor = async (rentalId) =>
  (
    await db
      .prepare('SELECT * FROM payments WHERE rental_id = ? ORDER BY id')
      .all(rentalId)
  ).map(presentPayment);

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

const loadRental = async (id) => db.prepare(RENTAL_SELECT + ' WHERE rt.id = ?').get(id);

/** POST /api/rentals — borrower requests a book for N days. */
router.post('/', requireAuth, rateLimit({ windowMs: 15 * 60_000, max: 30 }), async (req, res) => {
  const { listingId, startDate, days, message = '' } = req.body || {};

  const listing = await db.prepare('SELECT * FROM listings WHERE id = ?').get(Number(listingId));
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

  if (startDate != null && !isDate(startDate))
    return res.status(400).json({ error: 'Choose a real start date.' });
  const start = startDate || todayISO();
  if (start < todayISO())
    return res.status(400).json({ error: 'The start date cannot be in the past.' });
  const end = addDays(start, n);

  const clash = (await db
    .prepare(
      `SELECT COUNT(*) AS n FROM rentals
       WHERE listing_id = ? AND status IN ('approved','active')
         AND NOT (end_date <= ? OR start_date >= ?)`
    )
    .get(listing.id, start, end)).n;
  if (clash > 0)
    return res.status(409).json({ error: 'The book is already lent out for those dates.' });

  const duplicate = (await db
    .prepare(
      `SELECT COUNT(*) AS n FROM rentals
       WHERE listing_id = ? AND borrower_id = ? AND status = 'requested'`
    )
    .get(listing.id, req.user.id)).n;
  if (duplicate > 0)
    return res.status(409).json({ error: 'You already have a pending request on this book.' });

  const q = quote(listing.price_per_day, n, listing.deposit);

  const info = await db
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

  res.status(201).json({ rental: present(await loadRental(info.lastInsertRowid), req.user.id) });
});

/** GET /api/rentals?role=borrower|lender */
router.get('/', requireAuth, async (req, res) => {
  const role = req.query.role === 'lender' ? 'lender' : 'borrower';
  const column = role === 'lender' ? 'rt.owner_id' : 'rt.borrower_id';

  const rows = await db
    .prepare(RENTAL_SELECT + ` WHERE ${column} = ? ORDER BY rt.created_at DESC`)
    .all(req.user.id);

  // One query for the ledger rather than one per rental.
  const byRental = new Map();
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const ledger = await db
      .prepare(
        `SELECT * FROM payments WHERE rental_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`
      )
      .all(...ids);
    for (const p of ledger) {
      if (!byRental.has(p.rental_id)) byRental.set(p.rental_id, []);
      byRental.get(p.rental_id).push(presentPayment(p));
    }
  }

  res.json({
    items: rows.map((r) => present(r, req.user.id, byRental.get(r.id) || [])),
  });
});

/**
 * POST /api/rentals/:id/pay — borrower settles the bill once the lender accepts.
 * The card details are passed straight to the gateway; only brand and last4 persist.
 */
router.post('/:id/pay', requireAuth, rateLimit({ windowMs: 15 * 60_000, max: 10 }), async (req, res) => {
  const rental = await db.prepare('SELECT * FROM rentals WHERE id = ?').get(Number(req.params.id));
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

  await transaction(async () => {
    await recordPayment.run(
      rental.id, rental.borrower_id, null, 'rental', rental.total,
      result.ok ? 'succeeded' : 'failed', 'card',
      result.brand, result.last4, result.reference, result.failureReason
    );
    if (result.ok)
      await db.prepare("UPDATE rentals SET paid_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ? AND paid_at IS NULL")
        .run(rental.id);
  });

  if (!result.ok) return res.status(402).json({ error: result.failureReason });

  const fresh = await loadRental(rental.id);
  res.json({ rental: present(fresh, req.user.id, await paymentsFor(rental.id)) });
});

/** POST /api/rentals/:id/review — borrower rates a finished rental. */
router.post('/:id/review', requireAuth, async (req, res) => {
  const rental = await db.prepare('SELECT * FROM rentals WHERE id = ?').get(Number(req.params.id));
  if (!rental) return res.status(404).json({ error: 'Rental not found.' });
  if (rental.borrower_id !== req.user.id)
    return res.status(403).json({ error: 'Only the borrower can review.' });
  if (rental.status !== 'returned')
    return res.status(409).json({ error: 'You can review once the book is returned.' });

  const rating = Math.round(Number(req.body?.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Rating must be 1 to 5.' });

  const already = await db.prepare('SELECT id FROM reviews WHERE rental_id = ?').get(rental.id);
  if (already) return res.status(409).json({ error: 'You already reviewed this rental.' });

  await db.prepare(
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
  settle: { from: ['returned'], to: 'returned', by: 'lender', requiresPaid: true },
};

/** Returning the book releases the deposit to the borrower and the rent to the lender. */
async function settle(rental) {
  if (rental.settled_at || !rental.paid_at) return Boolean(rental.settled_at);

  const previous = new Set(
    (
      await db
        .prepare("SELECT kind FROM payments WHERE rental_id = ? AND status = 'succeeded'")
        .all(rental.id)
    ).map((row) => row.kind)
  );
  const attempts = [];
  let depositOk = rental.deposit === 0 || previous.has('deposit_refund');
  let payoutOk = previous.has('payout');

  if (!depositOk) {
    const result = refund({ amount: rental.deposit });
    attempts.push([rental.borrower_id, 'deposit_refund', rental.deposit, result, 'card']);
    depositOk = result.ok;
  }

  // The platform keeps the service fee; the lender receives the rent.
  if (!payoutOk) {
    const result = payout({ amount: rental.subtotal });
    attempts.push([rental.owner_id, 'payout', rental.subtotal, result, 'transfer']);
    payoutOk = result.ok;
  }

  const complete = depositOk && payoutOk;
  await transaction(async () => {
    for (const [payeeId, kind, amount, result, method] of attempts) {
      await recordPayment.run(
        rental.id, null, payeeId, kind, amount, result.ok ? 'succeeded' : 'failed', method,
        '', '', result.reference, result.failureReason
      );
    }
    if (complete)
      await db.prepare("UPDATE rentals SET settled_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ? AND settled_at IS NULL")
        .run(rental.id);
  });
  return complete;
}

/** Cancelling a paid rental returns everything the borrower handed over. */
async function refundCancellation(rental) {
  if (!rental.paid_at || rental.settled_at) return Boolean(rental.settled_at);
  const alreadyRefunded = await db.prepare(
    "SELECT id FROM payments WHERE rental_id = ? AND kind = 'cancellation_refund' AND status = 'succeeded'"
  ).get(rental.id);
  if (alreadyRefunded) {
    await transaction(async () => {
      await db.prepare("UPDATE rentals SET settled_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ? AND settled_at IS NULL")
        .run(rental.id);
    });
    return true;
  }
  const r = refund({ amount: rental.total });
  await transaction(async () => {
    await recordPayment.run(
      rental.id, null, rental.borrower_id, 'cancellation_refund', rental.total,
      r.ok ? 'succeeded' : 'failed', 'card', '', '', r.reference, r.failureReason
    );
    if (r.ok)
      await db.prepare("UPDATE rentals SET settled_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ? AND settled_at IS NULL")
        .run(rental.id);
  });
  return r.ok;
}

router.post('/:id/:action', requireAuth, async (req, res) => {
  const rule = TRANSITIONS[req.params.action];
  if (!rule) return res.status(404).json({ error: 'Unknown action.' });

  const rental = await db.prepare('SELECT * FROM rentals WHERE id = ?').get(Number(req.params.id));
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
    await db.prepare(
      `UPDATE rentals SET status = 'declined'
       WHERE listing_id = ? AND id != ? AND status = 'requested'
         AND NOT (end_date <= ? OR start_date >= ?)`
    ).run(rental.listing_id, rental.id, rental.start_date, rental.end_date);
  }

  if (req.params.action !== 'settle')
    await db.prepare('UPDATE rentals SET status = ? WHERE id = ?').run(rule.to, rental.id);

  let settlementComplete = true;
  if (rule.to === 'returned') settlementComplete = await settle({ ...rental, status: 'returned' });
  if (rule.to === 'cancelled') settlementComplete = await refundCancellation(rental);

  const fresh = await loadRental(rental.id);
  res.status(settlementComplete ? 200 : 202).json({
    rental: present(fresh, req.user.id, await paymentsFor(rental.id)),
    warning: settlementComplete ? undefined : 'Settlement is pending. Retry it from the lender dashboard.',
  });
});

export default router;
