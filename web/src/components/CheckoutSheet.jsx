import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import BookCover from './BookCover';
import { Sheet, Field, Alert, Spinner, Icon } from './ui';
import { money, plural, dateLabel } from '../lib/format';

const groupCardNumber = (value) =>
  value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim();

const formatExpiry = (value) => {
  const d = value.replace(/\D/g, '').slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}/${d.slice(2)}`;
};

const EMPTY = { number: '', expiry: '', cvc: '' };

/**
 * Card checkout for an accepted rental. The card never touches our own state
 * beyond this component — it goes straight to the gateway, which returns only
 * the brand and last four digits.
 */
export default function CheckoutSheet({ rental, onClose, onPaid }) {
  const [card, setCard] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCard(EMPTY);
    setError('');
    setBusy(false);
  }, [rental?.id]);

  if (!rental) return null;

  const [expMonth, expYear] = card.expiry.split('/');

  const pay = async () => {
    setError('');
    setBusy(true);
    try {
      const { rental: updated } = await api.payRental(rental.id, {
        number: card.number.replace(/\s/g, ''),
        expMonth: Number(expMonth),
        expYear: Number(expYear) + 2000,
        cvc: card.cvc,
      });
      onPaid(updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const ready =
    card.number.replace(/\D/g, '').length >= 12 &&
    /^\d{2}\/\d{2}$/.test(card.expiry) &&
    card.cvc.replace(/\D/g, '').length >= 3;

  return (
    <Sheet open={Boolean(rental)} onClose={onClose} title="Pay to confirm">
      <div className="flex gap-4 pb-5 border-b border-line">
        <div className="w-16 shrink-0 rounded-lg overflow-hidden">
          <BookCover title={rental.title} author={rental.author} coverUrl={rental.coverUrl} size="sm" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{rental.title}</p>
          <p className="text-[14px] text-muted">{rental.owner.name} accepted your request</p>
          <p className="text-[14px] text-muted mt-1">
            {dateLabel(rental.startDate)} → {dateLabel(rental.endDate)} · {plural(rental.days, 'day')}
          </p>
        </div>
      </div>

      <dl className="py-5 space-y-2.5 text-[15px] border-b border-line">
        <Line
          label={`${money(rental.pricePerDay)} × ${plural(rental.days, 'day')}`}
          value={money(rental.subtotal)}
        />
        <Line label="Service fee" value={money(rental.serviceFee)} />
        {rental.deposit > 0 && (
          <Line label="Deposit (refunded on return)" value={money(rental.deposit)} />
        )}
        <div className="flex justify-between pt-3 font-bold text-[17px]">
          <dt>Total</dt>
          <dd>{money(rental.total)}</dd>
        </div>
      </dl>

      <div className="pt-6 space-y-5">
        <Field label="Card number">
          <div className="relative">
            <input
              inputMode="numeric"
              autoComplete="cc-number"
              value={card.number}
              onChange={(e) => setCard({ ...card, number: groupCardNumber(e.target.value) })}
              placeholder="4242 4242 4242 4242"
              className="input pr-12 tabular-nums tracking-wide"
            />
            <Icon
              name="card"
              className="w-5 h-5 absolute right-4 top-1/2 -translate-y-1/2 text-muted"
            />
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Expiry">
            <input
              inputMode="numeric"
              autoComplete="cc-exp"
              value={card.expiry}
              onChange={(e) => setCard({ ...card, expiry: formatExpiry(e.target.value) })}
              placeholder="MM/YY"
              className="input tabular-nums"
            />
          </Field>
          <Field label="Security code">
            <input
              inputMode="numeric"
              autoComplete="cc-csc"
              value={card.cvc}
              onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) })}
              placeholder="123"
              className="input tabular-nums"
            />
          </Field>
        </div>

        {error && <Alert>{error}</Alert>}

        <button onClick={pay} disabled={busy || !ready} className="btn-primary w-full">
          {busy ? <Spinner className="w-5 h-5" /> : `Pay ${money(rental.total)}`}
        </button>

        <div className="rounded-lg bg-mist p-4 text-[12px] text-muted leading-relaxed">
          <p className="font-semibold text-ink mb-1">Simulated gateway</p>
          No real money moves and no card details are stored — only the brand and last four
          digits. Any future expiry and a 3-digit code will do.
          <span className="block mt-2 space-y-0.5">
            <span className="block"><b className="text-ink">4242 4242 4242 4242</b> succeeds</span>
            <span className="block"><b className="text-ink">4000 0000 0000 0002</b> is declined</span>
            <span className="block"><b className="text-ink">4000 0000 0009 0003</b> has insufficient funds</span>
          </span>
        </div>
      </div>
    </Sheet>
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
