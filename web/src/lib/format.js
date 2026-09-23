export const CURRENCY = '৳';

export const money = (n) => `${CURRENCY}${Number(n || 0).toLocaleString('en-US')}`;

export const perDay = (n) => `${money(n)}/day`;

export const km = (d) => (d == null ? null : d < 1 ? `${Math.round(d * 1000)} m` : `${d} km`);

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function dateLabel(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(String(iso).replace(' ', 'T') + (iso.includes('T') ? '' : 'Z'));
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const STATUS_COPY = {
  requested: { label: 'Awaiting lender', tone: 'pending' },
  approved: { label: 'Accepted', tone: 'good' },
  active: { label: 'With borrower', tone: 'good' },
  returned: { label: 'Returned', tone: 'done' },
  declined: { label: 'Declined', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
};

/** "Sept 2026" — used for join dates, where a relative age reads oddly. */
export function monthYear(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T') + (String(iso).includes('T') ? '' : 'Z'));
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/** Accepted but not yet paid — a borrower-facing state, not a rental status. */
export const PAYMENT_COPY = {
  awaiting: { label: "Pay to confirm", tone: "pending" },
};
