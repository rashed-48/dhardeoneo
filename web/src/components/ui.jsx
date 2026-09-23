import { useEffect } from 'react';

export function Star({ className = 'w-3.5 h-3.5', filled = true }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
      <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.3l6.5-.9L12 2.5z" />
    </svg>
  );
}

/** Compact rating pill: one star, the number, then the count — Uber's pattern. */
export function Rating({ value, count, className = '' }) {
  if (value == null || !count)
    return <span className={`text-[13px] text-muted ${className}`}>No ratings yet</span>;
  return (
    <span className={`inline-flex items-center gap-1 text-[13px] font-medium ${className}`}>
      <Star className="w-3.5 h-3.5" />
      {Number(value).toFixed(1)}
      <span className="text-muted font-normal">({count})</span>
    </span>
  );
}

export function StarRow({ value, size = 'w-4 h-4' }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`${size} ${n <= value ? 'text-ink' : 'text-line'}`} />
      ))}
    </span>
  );
}

export function Spinner({ className = 'w-5 h-5' }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.18" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = 'Loading' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-24 text-muted">
      <Spinner />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

export function Empty({ title, body, action }) {
  return (
    <div className="text-center py-20 px-6 rise">
      <div className="w-14 h-14 rounded-full bg-mist mx-auto mb-5 grid place-items-center">
        <svg viewBox="0 0 24 24" className="w-6 h-6 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z" />
          <path d="M20 18v3H6.5A2.5 2.5 0 0 1 4 18.5" />
        </svg>
      </div>
      <h3 className="text-xl font-bold mb-2">{title}</h3>
      {body && <p className="text-muted max-w-sm mx-auto text-[15px] leading-relaxed">{body}</p>}
      {action && <div className="mt-7">{action}</div>}
    </div>
  );
}

export function Alert({ children, tone = 'error' }) {
  if (!children) return null;
  const tones = {
    error: 'bg-ink text-paper',
    info: 'bg-mist text-ink',
  };
  return (
    <div className={`${tones[tone]} rounded-lg px-4 py-3 text-sm font-medium rise`} role="alert">
      {children}
    </div>
  );
}

export function StatusPill({ status, label }) {
  const styles = {
    pending: 'bg-mist text-ink',
    good: 'bg-ink text-paper',
    done: 'bg-paper text-muted border border-line',
    bad: 'bg-paper text-muted border border-line line-through decoration-1',
  };
  return (
    <span className={`inline-flex items-center h-7 px-3 rounded-full text-[12px] font-semibold ${styles[status] || styles.pending}`}>
      {label}
    </span>
  );
}

export function Field({ label, hint, error, children }) {
  return (
    <div>
      {label && <label className="label">{label}</label>}
      {children}
      {hint && !error && <p className="mt-1.5 text-[12px] text-muted">{hint}</p>}
      {error && <p className="mt-1.5 text-[12px] font-medium text-ink">{error}</p>}
    </div>
  );
}

/** Bottom sheet on mobile, centred dialog on desktop. */
export function Sheet({ open, onClose, title, children, maxWidth = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full ${maxWidth} bg-paper rounded-t-2xl sm:rounded-2xl
                    max-h-[88vh] overflow-y-auto rise shadow-2xl`}
      >
        <div className="sticky top-0 bg-paper flex items-center justify-between px-6 h-16 border-b border-line z-10">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 grid place-items-center rounded-full hover:bg-mist">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export function Icon({ name, className = 'w-4 h-4' }) {
  const paths = {
    pin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 11h18" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    check: <path d="m4 12 5 5L20 6" />,
    sliders: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z" /><path d="M20 18v3H6.5A2.5 2.5 0 0 1 4 18.5" /></>,
    chat: <path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1-5.5A8 8 0 1 1 21 12z" />,
    shield: <><path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" /><path d="m9 12 2 2 4-4" /></>,
    card: <><rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M2 10h20" /></>,
    receipt: <><path d="M5 3h14v18l-2.3-1.6-2.4 1.6-2.3-1.6L9.7 21l-2.4-1.6L5 21V3z" /><path d="M9 8h6M9 12h6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
