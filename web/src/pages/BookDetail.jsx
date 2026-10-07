import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../store/AppContext';
import BookCover from '../components/BookCover';
import ListingCard from '../components/ListingCard';
import { Rating, StarRow, Icon, Loading, Empty, Alert, Sheet, Field, Spinner } from '../components/ui';
import { money, km, dateLabel, timeAgo, monthYear, todayISO, addDaysISO, plural } from '../lib/format';

/** Mirrors the server's pricing so the borrower sees the bill before committing. */
function quote(pricePerDay, days, deposit) {
  const subtotal = pricePerDay * days;
  const serviceFee = Math.max(5, Math.round(subtotal * 0.05));
  return { subtotal, serviceFee, deposit, total: subtotal + serviceFee + deposit };
}

export default function BookDetail() {
  const { id } = useParams();
  const { user, place } = useApp();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [days, setDays] = useState(7);
  const [startDate, setStartDate] = useState(todayISO());
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null);
    setNotFound(false);
    api
      .listing(id, { lat: place.lat, lng: place.lng })
      .then((d) => {
        if (!live) return;
        setData(d);
        setDays(Math.max(d.listing.minDays, Math.min(7, d.listing.maxDays)));
      })
      .catch(() => live && setNotFound(true));
    return () => {
      live = false;
    };
  }, [id, place.lat, place.lng]);

  if (notFound)
    return (
      <Empty
        title="We could not find that book"
        body="It may have been taken down by its owner."
        action={<Link to="/browse" className="btn-primary">Browse other books</Link>}
      />
    );

  if (!data) return <Loading label="Loading book" />;

  const { listing: b, reviews, busy, alsoFrom } = data;
  const isOwner = user?.id === b.owner.id;
  const q = quote(b.pricePerDay, days, b.deposit);
  const endDate = addDaysISO(startDate, days);

  const submit = async () => {
    if (!user) {
      navigate('/login', { state: { from: `/book/${b.id}` } });
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const { rental } = await api.requestRental({
        listingId: b.id,
        startDate,
        days,
        message,
      });
      setConfirmOpen(false);
      setDone(rental);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-5 py-8">
      <Link to="/browse" className="inline-flex items-center gap-2 text-[14px] text-muted hover:text-ink mb-6">
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5m6-6-6 6 6 6" />
        </svg>
        All books
      </Link>

      <div className="grid lg:grid-cols-[320px_1fr_360px] gap-10">
        {/* Cover */}
        <div>
          <div className="rounded-xl overflow-hidden border border-line sticky top-24">
            <BookCover title={b.title} author={b.author} coverUrl={b.coverUrl} size="lg" />
          </div>
        </div>

        {/* Details */}
        <div className="min-w-0">
          <span className="tag">{b.category}</span>
          <h1 className="text-[32px] sm:text-[40px] font-extrabold leading-[1.05] mt-3">{b.title}</h1>
          <p className="text-lg text-muted mt-1.5">{b.author}</p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-5">
            <Rating value={b.rating} count={b.reviewCount} className="text-[15px]" />
            {b.distanceKm != null && (
              <span className="inline-flex items-center gap-1.5 text-[15px] text-muted">
                <Icon name="pin" className="w-4 h-4" />
                {km(b.distanceKm)} from {place.name} · {b.area}
              </span>
            )}
          </div>

          {b.lentOut && (
            <div className="mt-5">
              <Alert tone="info">
                This copy is with another borrower right now. You can still request it for later dates.
              </Alert>
            </div>
          )}

          {b.description && (
            <p className="mt-7 text-[16px] leading-relaxed text-ink/80 max-w-xl">{b.description}</p>
          )}

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line border border-line rounded-xl overflow-hidden mt-8">
            <Spec label="Condition" value={b.condition} />
            <Spec label="Language" value={b.language} />
            <Spec label="Lend period" value={`${b.minDays}–${b.maxDays} days`} />
            <Spec label="Deposit" value={b.deposit ? money(b.deposit) : 'None'} />
          </dl>

          {/* Lender */}
          <section className="mt-10 pt-8 border-t border-line">
            <h2 className="text-xl font-bold mb-4">About the lender</h2>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-ink text-paper grid place-items-center text-lg font-bold shrink-0">
                {b.owner.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="font-semibold">{b.owner.name}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[14px] text-muted">
                  <Rating value={b.owner.rating} count={b.owner.reviewCount} />
                  <span aria-hidden="true">·</span>
                  <span>Joined {monthYear(b.owner.since)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{b.owner.area}</span>
                </div>
                <p className="mt-3 text-[14px] text-muted inline-flex items-start gap-2">
                  <Icon name="shield" className="w-4 h-4 mt-0.5 shrink-0" />
                  Their phone number is shared once the lender accepts. Arrange the exact pickup point together.
                </p>
              </div>
            </div>
          </section>

          {/* Booked dates */}
          {busy.length > 0 && (
            <section className="mt-8">
              <h3 className="font-bold mb-3">Already booked</h3>
              <ul className="flex flex-wrap gap-2">
                {busy.map((w, i) => (
                  <li key={i} className="tag normal-case tracking-normal text-[12px] py-1.5">
                    {dateLabel(w.startDate)} → {dateLabel(w.endDate)}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Reviews */}
          <section className="mt-10 pt-8 border-t border-line">
            <div className="flex items-baseline gap-3 mb-6">
              <h2 className="text-xl font-bold">Reviews</h2>
              <span className="text-muted text-[15px]">{plural(reviews.length, 'review')}</span>
            </div>

            {reviews.length === 0 ? (
              <p className="text-muted">No reviews on this copy yet.</p>
            ) : (
              <ul className="space-y-6">
                {reviews.map((r) => (
                  <li key={r.id} className="pb-6 border-b border-line last:border-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-mist grid place-items-center text-[13px] font-bold">
                        {r.reviewer.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-[15px]">{r.reviewer}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <StarRow value={r.rating} size="w-3.5 h-3.5" />
                          <span className="text-[12px] text-muted">{timeAgo(r.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    {r.comment && <p className="mt-3 text-[15px] leading-relaxed text-ink/80">{r.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Borrow panel */}
        <div>
          <div className="sticky top-24 card p-6 shadow-sm">
            {done ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 rounded-full bg-ink text-paper grid place-items-center mx-auto mb-4">
                  <Icon name="check" className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold">Request sent</h3>
                <p className="text-muted text-[15px] mt-2 leading-relaxed">
                  {b.owner.name} has been asked for {plural(done.days, 'day')} from{' '}
                  {dateLabel(done.startDate)}. Once they accept, you pay {money(done.total)} to
                  confirm the dates.
                </p>
                <Link to="/dashboard" className="btn-primary w-full mt-6">Track this request</Link>
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-extrabold">{money(b.pricePerDay)}</span>
                  <span className="text-muted">per day</span>
                </div>
                {b.deposit > 0 && (
                  <p className="text-[13px] text-muted mt-1">
                    + {money(b.deposit)} refundable deposit
                  </p>
                )}

                <div className="space-y-5 mt-6">
                  <Field label="Start date">
                    <input
                      type="date"
                      value={startDate}
                      min={todayISO()}
                      onChange={(e) => setStartDate(e.target.value || todayISO())}
                      className="input"
                    />
                  </Field>

                  <Field label={`How many days? (${b.minDays}–${b.maxDays})`}>
                    <div className="flex items-center gap-3">
                      <Stepper
                        value={days}
                        min={b.minDays}
                        max={b.maxDays}
                        onChange={setDays}
                      />
                    </div>
                    <p className="mt-2 text-[12px] text-muted">
                      Return by {dateLabel(endDate)}
                    </p>
                  </Field>
                </div>

                <dl className="mt-6 pt-5 border-t border-line space-y-2.5 text-[15px]">
                  <Line
                    label={`${money(b.pricePerDay)} × ${plural(days, 'day')}`}
                    value={money(q.subtotal)}
                  />
                  <Line label="Service fee" value={money(q.serviceFee)} />
                  {b.deposit > 0 && <Line label="Deposit (refundable)" value={money(q.deposit)} />}
                  <div className="flex justify-between pt-3 border-t border-line font-bold text-[17px]">
                    <dt>Total</dt>
                    <dd>{money(q.total)}</dd>
                  </div>
                </dl>

                {error && <div className="mt-4"><Alert>{error}</Alert></div>}

                {isOwner ? (
                  <Link to="/dashboard" className="btn-secondary w-full mt-6">
                    This is your listing
                  </Link>
                ) : (
                  <button
                    onClick={() => (user ? setConfirmOpen(true) : navigate('/login', { state: { from: `/book/${b.id}` } }))}
                    className="btn-primary w-full mt-6"
                  >
                    {user ? 'Request to borrow' : 'Log in to borrow'}
                  </button>
                )}

                <p className="text-[12px] text-muted text-center mt-3 leading-relaxed">
                  Nothing is charged now. You pay only after {b.owner.name} accepts.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {alsoFrom.length > 0 && (
        <section className="mt-16 pt-10 border-t border-line">
          <h2 className="text-2xl font-extrabold mb-6">More from {b.owner.name}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
            {alsoFrom.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        </section>
      )}

      <Sheet open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm your request">
        <div className="flex gap-4 pb-5 border-b border-line">
          <div className="w-16 shrink-0 rounded-lg overflow-hidden">
            <BookCover title={b.title} author={b.author} coverUrl={b.coverUrl} size="sm" />
          </div>
          <div>
            <p className="font-semibold leading-snug">{b.title}</p>
            <p className="text-[14px] text-muted">{b.author}</p>
            <p className="text-[14px] text-muted mt-1">Pickup in {b.area} · {b.owner.name}</p>
          </div>
        </div>

        <dl className="py-5 space-y-2.5 text-[15px] border-b border-line">
          <Line label="Dates" value={`${dateLabel(startDate)} → ${dateLabel(endDate)}`} />
          <Line label="Duration" value={plural(days, 'day')} />
          <Line label={`${money(b.pricePerDay)} × ${plural(days, 'day')}`} value={money(q.subtotal)} />
          <Line label="Service fee" value={money(q.serviceFee)} />
          {b.deposit > 0 && <Line label="Deposit (refundable)" value={money(q.deposit)} />}
          <div className="flex justify-between pt-3 font-bold text-[17px]">
            <dt>Due when accepted</dt>
            <dd>{money(q.total)}</dd>
          </div>
        </dl>

        <div className="pt-5">
          <Field label="Message to the lender (optional)">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="When could you hand it over?"
              className="input"
            />
          </Field>
        </div>

        {error && <div className="mt-4"><Alert>{error}</Alert></div>}

        <button onClick={submit} disabled={submitting} className="btn-primary w-full mt-6">
          {submitting ? <Spinner className="w-5 h-5" /> : 'Send request'}
        </button>
      </Sheet>
    </div>
  );
}

function Spec({ label, value }) {
  return (
    <div className="bg-paper p-4">
      <dt className="text-[11px] uppercase tracking-wider text-muted font-semibold">{label}</dt>
      <dd className="font-semibold mt-1 text-[15px]">{value}</dd>
    </div>
  );
}

function Line({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Stepper({ value, min, max, onChange }) {
  const btn = 'w-11 h-11 rounded-lg bg-mist hover:bg-line grid place-items-center disabled:opacity-35 disabled:pointer-events-none text-xl font-medium';
  return (
    <div className="flex items-center gap-3 w-full">
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className={btn} aria-label="Fewer days">−</button>
      <div className="flex-1 text-center">
        <span className="text-2xl font-bold tabular-nums">{value}</span>
        <span className="text-muted text-sm ml-1.5">days</span>
      </div>
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} className={btn} aria-label="More days">+</button>
    </div>
  );
}
