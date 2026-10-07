import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../store/AppContext';
import BookCover from '../components/BookCover';
import CheckoutSheet from '../components/CheckoutSheet';
import {
  Loading, Empty, Alert, StatusPill, Sheet, Field, Spinner, Icon, Star, Rating,
} from '../components/ui';
import { money, perDay, dateLabel, plural, timeAgo, STATUS_COPY, PAYMENT_COPY } from '../lib/format';

const TABS = [
  { id: 'borrowing', label: 'Borrowing' },
  { id: 'lending', label: 'Requests to me' },
  { id: 'shelf', label: 'My books' },
];

export default function Dashboard() {
  const { user, booting, place } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'borrowing';

  const [borrowing, setBorrowing] = useState(null);
  const [lending, setLending] = useState(null);
  const [shelf, setShelf] = useState(null);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(null);
  const [paying, setPaying] = useState(null);

  useEffect(() => {
    if (!booting && !user) navigate('/login', { state: { from: '/dashboard' } });
  }, [booting, user, navigate]);

  const load = useCallback(() => {
    if (!user) return;
    api.rentals('borrower').then((r) => setBorrowing(r.items)).catch(() => setBorrowing([]));
    api.rentals('lender').then((r) => setLending(r.items)).catch(() => setLending([]));
    api
      .listings({ ownerId: user.id, includeOwn: true, lat: place.lat, lng: place.lng })
      .then((r) => setShelf(r.items))
      .catch(() => setShelf([]));
  }, [user, place.lat, place.lng]);

  useEffect(load, [load]);

  if (booting) return <Loading />;
  if (!user) return null;

  const act = async (rental, action) => {
    setError('');
    try {
      await api.rentalAction(rental.id, action);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const pendingCount = (lending || []).filter((r) => r.status === 'requested').length;
  // Earnings come from the payment ledger, not from assumed rental status.
  const earned = (lending || []).reduce((sum, r) => sum + r.payoutAmount, 0);
  const pipeline = (lending || [])
    .filter((r) => r.paidAt && !r.settledAt)
    .reduce((sum, r) => sum + r.subtotal, 0);
  const toPay = (borrowing || []).filter((r) => r.awaitingPayment);

  return (
    <div className="max-w-5xl mx-auto px-5 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[36px] font-extrabold leading-tight">Your rentals</h1>
          <p className="text-muted mt-1.5 text-[15px]">
            Hello {user.name.split(' ')[0]} — everything you are lending and borrowing.
          </p>
        </div>
        <Link to="/lend" className="btn-primary">
          <Icon name="plus" className="w-4 h-4" />
          Lend a book
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-px bg-line border border-line rounded-xl overflow-hidden mt-8">
        <Metric label="Books listed" value={shelf?.length ?? '—'} />
        <Metric label="Awaiting your reply" value={pendingCount} />
        <Metric
          label={pipeline ? `Paid out · ${money(pipeline)} still running` : 'Paid out to you'}
          value={money(earned)}
        />
      </div>

      {toPay.length > 0 && (
        <div className="mt-6 card p-5 flex flex-wrap items-center justify-between gap-4 rise">
          <div className="flex items-start gap-3">
            <Icon name="card" className="w-5 h-5 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">{plural(toPay.length, 'rental')} waiting for payment</p>
              <p className="text-[14px] text-muted mt-0.5">
                The lender accepted. Pay to lock in your dates and get their contact details.
              </p>
            </div>
          </div>
          <button onClick={() => setPaying(toPay[0])} className="btn-primary btn-sm">
            Pay {money(toPay[0].total)}
          </button>
        </div>
      )}

      <div className="flex gap-1 mt-9 border-b border-line overflow-x-auto no-scrollbar">
        {TABS.map((t) => {
          const active = tab === t.id;
          const badge = t.id === 'lending' && pendingCount > 0 ? pendingCount : null;
          return (
            <button
              key={t.id}
              onClick={() => setParams({ tab: t.id }, { replace: true })}
              className={`relative px-4 h-12 text-[15px] font-medium whitespace-nowrap transition-colors
                ${active ? 'text-ink' : 'text-muted hover:text-ink'}`}
            >
              {t.label}
              {badge && (
                <span className="ml-2 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-ink text-paper text-[11px] font-bold">
                  {badge}
                </span>
              )}
              {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-ink" />}
            </button>
          );
        })}
      </div>

      {error && <div className="mt-6"><Alert>{error}</Alert></div>}

      <div className="mt-8">
        {tab === 'borrowing' && (
          <RentalList
            items={borrowing}
            role="borrower"
            onAct={act}
            onReview={setReviewing}
            onPay={setPaying}
            empty={
              <Empty
                title="You have not borrowed anything yet"
                body="Find a book near you and ask its owner for a few days."
                action={<Link to="/browse" className="btn-primary">Browse books</Link>}
              />
            }
          />
        )}

        {tab === 'lending' && (
          <RentalList
            items={lending}
            role="lender"
            onAct={act}
            empty={
              <Empty
                title="No requests yet"
                body="Once someone asks for one of your books it will show up here for you to accept or decline."
                action={<Link to="/lend" className="btn-primary">List another book</Link>}
              />
            }
          />
        )}

        {tab === 'shelf' && <Shelf items={shelf} />}
      </div>

      <CheckoutSheet
        rental={paying}
        onClose={() => setPaying(null)}
        onPaid={() => {
          setPaying(null);
          load();
        }}
      />

      <ReviewSheet
        rental={reviewing}
        onClose={() => setReviewing(null)}
        onDone={() => {
          setReviewing(null);
          load();
        }}
      />
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="bg-paper p-5">
      <div className="text-2xl font-extrabold tabular-nums">{value}</div>
      <div className="text-[12px] text-muted mt-1 leading-snug">{label}</div>
    </div>
  );
}

function RentalList({ items, role, onAct, onReview, onPay, empty }) {
  if (!items) return <Loading />;
  if (items.length === 0) return empty;

  const order = { requested: 0, approved: 1, active: 2, returned: 3, declined: 4, cancelled: 5 };
  const sorted = [...items].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <div className="flex flex-col gap-4 rise">
      {sorted.map((r) => (
        <RentalCard
          key={r.id}
          rental={r}
          role={role}
          onAct={onAct}
          onReview={onReview}
          onPay={onPay}
        />
      ))}
    </div>
  );
}

function RentalCard({ rental: r, role, onAct, onReview, onPay }) {
  const copy = r.awaitingPayment
    ? PAYMENT_COPY.awaiting
    : STATUS_COPY[r.status] || { label: r.status, tone: 'pending' };
  const other = role === 'lender' ? r.borrower : r.owner;

  const actions = [];
  if (role === 'lender') {
    if (r.status === 'requested') {
      actions.push(['Accept', 'approve', 'btn-primary btn-sm']);
      actions.push(['Decline', 'decline', 'btn-secondary btn-sm']);
    }
    // Handing over is blocked until the borrower has paid; if they never do,
    // the lender can withdraw instead.
    if (r.status === 'approved' && r.paidAt)
      actions.push(['Mark handed over', 'handover', 'btn-primary btn-sm']);
    if (r.status === 'approved' && !r.paidAt)
      actions.push(['Withdraw', 'cancel', 'btn-secondary btn-sm']);
    if (r.status === 'active') actions.push(['Mark returned', 'return', 'btn-primary btn-sm']);
    if (r.status === 'returned' && r.paidAt && !r.settledAt)
      actions.push(['Retry settlement', 'settle', 'btn-primary btn-sm']);
  } else {
    if (['requested', 'approved'].includes(r.status))
      actions.push(['Cancel request', 'cancel', 'btn-secondary btn-sm']);
  }

  return (
    <article className="card p-5">
      <div className="flex gap-4">
        <Link to={`/book/${r.listingId}`} className="w-16 sm:w-20 shrink-0 rounded-lg overflow-hidden">
          <BookCover title={r.title} author={r.author} coverUrl={r.coverUrl} size="sm" />
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link to={`/book/${r.listingId}`} className="font-semibold leading-snug hover:underline decoration-1 underline-offset-2">
                {r.title}
              </Link>
              <p className="text-[13px] text-muted">{r.author}</p>
            </div>
            <StatusPill status={copy.tone} label={copy.label} />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[13px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="calendar" className="w-3.5 h-3.5" />
              {dateLabel(r.startDate)} → {dateLabel(r.endDate)} · {plural(r.days, 'day')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="pin" className="w-3.5 h-3.5" />
              {r.pickupArea}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="user" className="w-3.5 h-3.5" />
              {role === 'lender' ? 'From' : 'Lender'} {other.name}
            </span>
          </div>

          {r.message && (
            <p className="mt-3 text-[14px] bg-mist rounded-lg px-3.5 py-2.5 leading-relaxed">
              <span className="text-muted">“</span>{r.message}<span className="text-muted">”</span>
            </p>
          )}

          {other.phone && (
            <p className="mt-3 text-[14px] inline-flex items-center gap-2 font-medium">
              <Icon name="chat" className="w-4 h-4" />
              {other.name} · <a href={`tel:${other.phone}`} className="underline underline-offset-2">{other.phone}</a>
            </p>
          )}

          {role === 'lender' && r.awaitingPayment && (
            <p className="mt-3 text-[13px] text-muted inline-flex items-center gap-2">
              <Icon name="clock" className="w-4 h-4" />
              Waiting for {r.borrower.name} to pay. Hand the book over once they have.
            </p>
          )}

          <Ledger rental={r} role={role} />

          <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-line">
            <div className="text-[14px]">
              <span className="font-bold">{money(r.total)}</span>
              <span className="text-muted"> total · {perDay(r.pricePerDay)}</span>
              {r.deposit > 0 && <span className="text-muted"> · {money(r.deposit)} deposit</span>}
            </div>

            <div className="flex flex-wrap gap-2">
              {role === 'borrower' && r.awaitingPayment && (
                <button onClick={() => onPay(r)} className="btn-primary btn-sm">
                  <Icon name="card" className="w-3.5 h-3.5" />
                  Pay {money(r.total)}
                </button>
              )}
              {actions.map(([label, action, className]) => (
                <button key={action} onClick={() => onAct(r, action)} className={className}>
                  {label}
                </button>
              ))}
              {role === 'borrower' && r.status === 'returned' && !r.reviewed && (
                <button onClick={() => onReview(r)} className="btn-primary btn-sm">
                  <Star className="w-3.5 h-3.5" />
                  Leave a review
                </button>
              )}
              {role === 'borrower' && r.reviewed && (
                <span className="text-[13px] text-muted self-center">Reviewed</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

/** Every movement of money on this rental, newest last. */
function Ledger({ rental, role }) {
  const rows = (rental.payments || []).filter((p) => p.status === 'succeeded');
  if (rows.length === 0) return null;

  const label = {
    rental: role === 'lender' ? 'Borrower paid' : 'You paid',
    deposit_refund: role === 'lender' ? 'Deposit returned' : 'Deposit refunded to you',
    cancellation_refund: role === 'lender' ? 'Refunded to borrower' : 'Refunded to you',
    payout: role === 'lender' ? 'Paid out to you' : 'Paid to the lender',
  };

  return (
    <dl className="mt-3 rounded-lg bg-mist px-3.5 py-3 space-y-1.5">
      {rows.map((p) => (
        <div key={p.id} className="flex justify-between gap-3 text-[13px]">
          <dt className="text-muted inline-flex items-center gap-2 min-w-0">
            <Icon name="receipt" className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {label[p.kind] || p.kind}
              {p.last4 && ` · ${p.brand} ···· ${p.last4}`}
            </span>
          </dt>
          <dd className="font-medium tabular-nums shrink-0">{money(p.amount)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Shelf({ items }) {
  if (!items) return <Loading />;
  if (items.length === 0)
    return (
      <Empty
        title="Your shelf is empty"
        body="List a book you have finished and start earning from it."
        action={<Link to="/lend" className="btn-primary">Lend a book</Link>}
      />
    );

  return (
    <div className="flex flex-col gap-3 rise">
      {items.map((l) => (
        <div key={l.id} className="card p-4 flex gap-4 items-center">
          <Link to={`/book/${l.id}`} className="w-14 shrink-0 rounded-lg overflow-hidden">
            <BookCover title={l.title} author={l.author} coverUrl={l.coverUrl} size="sm" />
          </Link>

          <div className="flex-1 min-w-0">
            <Link to={`/book/${l.id}`} className="font-semibold truncate block hover:underline decoration-1 underline-offset-2">
              {l.title}
            </Link>
            <p className="text-[13px] text-muted truncate">{l.author}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[13px]">
              <span className="font-medium">{perDay(l.pricePerDay)}</span>
              <Rating value={l.rating} count={l.reviewCount} />
              {l.lentOut && <span className="tag">Lent out</span>}
              <span className="text-muted">Listed {timeAgo(l.createdAt)}</span>
            </div>
          </div>

          <Link to={`/lend/${l.id}`} className="btn-secondary btn-sm shrink-0">Edit</Link>
        </div>
      ))}
    </div>
  );
}

function ReviewSheet({ rental, onClose, onDone }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRating(5);
    setComment('');
    setError('');
  }, [rental?.id]);

  if (!rental) return null;

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      await api.reviewRental(rental.id, { rating, comment });
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={Boolean(rental)} onClose={onClose} title="How was it?">
      <div className="flex gap-4 pb-5 border-b border-line">
        <div className="w-14 shrink-0 rounded-lg overflow-hidden">
          <BookCover title={rental.title} author={rental.author} coverUrl={rental.coverUrl} size="sm" />
        </div>
        <div>
          <p className="font-semibold leading-snug">{rental.title}</p>
          <p className="text-[14px] text-muted">Lent by {rental.owner.name}</p>
        </div>
      </div>

      <div className="pt-6 space-y-6">
        <Field label="Your rating">
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                className={`w-12 h-12 rounded-lg grid place-items-center transition-colors
                  ${n <= rating ? 'bg-ink text-paper' : 'bg-mist text-muted hover:bg-line'}`}
              >
                <Star className="w-5 h-5" />
              </button>
            ))}
          </div>
        </Field>

        <Field label="Anything worth saying? (optional)">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            maxLength={800}
            className="input"
            placeholder="Was the copy as described? Was pickup easy?"
          />
        </Field>

        {error && <Alert>{error}</Alert>}

        <button onClick={submit} disabled={busy} className="btn-primary w-full">
          {busy ? <Spinner className="w-5 h-5" /> : 'Post review'}
        </button>
      </div>
    </Sheet>
  );
}
