import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../store/AppContext';
import BookCover from '../components/BookCover';
import { Field, Alert, Spinner, Loading, Rating, Icon } from '../components/ui';
import { money } from '../lib/format';

const CONDITIONS = ['Like new', 'Good', 'Fair'];
const LANGUAGES = ['English', 'Bangla', 'Other'];

const EMPTY = {
  title: '',
  author: '',
  category: 'Fiction',
  language: 'English',
  condition: 'Good',
  description: '',
  coverUrl: '',
  pricePerDay: 12,
  deposit: 300,
  minDays: 3,
  maxDays: 21,
  area: '',
  status: 'available',
};

export default function ListBook() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { user, config, booting } = useApp();
  const navigate = useNavigate();

  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(editing);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [coverState, setCoverState] = useState({ busy: false, note: '' });

  useEffect(() => {
    if (!booting && !user) navigate('/login', { state: { from: editing ? `/lend/${id}` : '/lend' } });
  }, [booting, user, navigate, editing, id]);

  useEffect(() => {
    if (user && !editing && !form.area) setForm((f) => ({ ...f, area: user.area || '' }));
  }, [user, editing, form.area]);

  useEffect(() => {
    if (!editing) return;
    api
      .listing(id)
      .then(({ listing }) => {
        setForm({
          title: listing.title,
          author: listing.author,
          category: listing.category,
          language: listing.language,
          condition: listing.condition,
          description: listing.description,
          coverUrl: listing.coverUrl || '',
          pricePerDay: listing.pricePerDay,
          deposit: listing.deposit,
          minDays: listing.minDays,
          maxDays: listing.maxDays,
          area: listing.area,
          status: listing.status,
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [editing, id]);

  if (booting || loading) return <Loading />;
  if (!user) return null;

  const set = (k) => (e) => {
    const raw = e.target.value;
    const numeric = ['pricePerDay', 'deposit', 'minDays', 'maxDays'].includes(k);
    setForm((f) => ({ ...f, [k]: numeric ? (raw === '' ? '' : Number(raw)) : raw }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const area = config.areas.find((a) => a.name === form.area);
      const payload = { ...form, lat: area?.lat, lng: area?.lng };
      const { listing } = editing
        ? await api.updateListing(id, payload)
        : await api.createListing(payload);
      navigate(`/book/${listing.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const findCover = async () => {
    if (!form.title.trim()) {
      setCoverState({ busy: false, note: 'Enter the title first.' });
      return;
    }
    setCoverState({ busy: true, note: '' });
    try {
      const hit = await api.coverLookup(form.title.trim(), form.author.trim());
      setForm((f) => ({ ...f, coverUrl: hit.coverUrl }));
      setCoverState({ busy: false, note: `Matched “${hit.matchedTitle}”.` });
    } catch (e) {
      setCoverState({ busy: false, note: e.message });
    }
  };

  const remove = async () => {
    if (!confirm('Take this book off Shelf? This cannot be undone.')) return;
    setError('');
    setBusy(true);
    try {
      await api.deleteListing(id);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const weekTotal = (Number(form.pricePerDay) || 0) * 7;

  return (
    <div className="max-w-7xl mx-auto px-5 py-10">
      <div className="grid lg:grid-cols-[1fr_360px] gap-12">
        <div className="max-w-2xl">
          <h1 className="text-[36px] font-extrabold leading-tight">
            {editing ? 'Edit your listing' : 'Lend a book'}
          </h1>
          <p className="text-muted mt-2 text-[15px]">
            {editing
              ? 'Change the price, dates or availability at any time.'
              : 'Set your own daily rate. You approve every request before anyone gets your details.'}
          </p>

          <form onSubmit={submit} className="mt-10 space-y-10">
            <section className="space-y-5">
              <h2 className="text-lg font-bold">The book</h2>

              <Field label="Title">
                <input value={form.title} onChange={set('title')} className="input" required placeholder="e.g. Sapiens" />
              </Field>

              <Field label="Author">
                <input value={form.author} onChange={set('author')} className="input" required placeholder="e.g. Yuval Noah Harari" />
              </Field>

              <div className="grid sm:grid-cols-3 gap-4">
                <Field label="Category">
                  <select value={form.category} onChange={set('category')} className="input">
                    {config.categories.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Language">
                  <select value={form.language} onChange={set('language')} className="input">
                    {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Condition">
                  <select value={form.condition} onChange={set('condition')} className="input">
                    {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Notes for the borrower" hint="Mention any marks, missing pages or pickup quirks. Honesty gets better reviews.">
                <textarea
                  value={form.description}
                  onChange={set('description')}
                  rows={4}
                  maxLength={2000}
                  className="input"
                  placeholder="Hardcover, no marks. Happy to hand over on weekday evenings."
                />
              </Field>

              <Field
                label="Cover art"
                hint="We look the jacket up for you. Without one, a clean generated cover is used instead."
              >
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={findCover}
                    disabled={coverState.busy}
                    className="btn-outline btn-sm"
                  >
                    {coverState.busy ? <Spinner className="w-4 h-4" /> : <Icon name="search" className="w-4 h-4" />}
                    {form.coverUrl ? 'Find a different cover' : 'Find the real cover'}
                  </button>
                  {form.coverUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setForm((f) => ({ ...f, coverUrl: '' }));
                        setCoverState({ busy: false, note: '' });
                      }}
                      className="btn-ghost btn-sm text-muted"
                    >
                      Use a generated cover
                    </button>
                  )}
                </div>
                {coverState.note && (
                  <p className="mt-2 text-[12px] text-muted">{coverState.note}</p>
                )}
              </Field>
            </section>

            <section className="space-y-5 pt-8 border-t border-line">
              <h2 className="text-lg font-bold">Your price</h2>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Price per day" hint={weekTotal ? `${money(weekTotal)} for a week` : undefined}>
                  <input type="number" min="1" value={form.pricePerDay} onChange={set('pricePerDay')} className="input" required />
                </Field>
                <Field label="Refundable deposit" hint="Held by you, returned when the book comes back.">
                  <input type="number" min="0" value={form.deposit} onChange={set('deposit')} className="input" />
                </Field>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Minimum days">
                  <input type="number" min="1" max="365" value={form.minDays} onChange={set('minDays')} className="input" required />
                </Field>
                <Field label="Maximum days">
                  <input type="number" min="1" max="365" value={form.maxDays} onChange={set('maxDays')} className="input" required />
                </Field>
              </div>
            </section>

            <section className="space-y-5 pt-8 border-t border-line">
              <h2 className="text-lg font-bold">Pickup</h2>
              <Field label="Area" hint="Borrowers see the area and the distance — never your exact address.">
                <select value={form.area} onChange={set('area')} className="input" required>
                  <option value="" disabled>Choose an area</option>
                  {config.areas.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
                </select>
              </Field>

              {editing && (
                <Field label="Visibility">
                  <div className="flex gap-2">
                    {[
                      ['available', 'Listed'],
                      ['paused', 'Paused'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, status: value }))}
                        className={`chip ${form.status === value ? 'chip-active' : ''}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </Field>
              )}
            </section>

            {error && <Alert>{error}</Alert>}

            <div className="flex flex-wrap gap-3 pt-2">
              <button type="submit" disabled={busy} className="btn-primary px-8">
                {busy ? <Spinner className="w-5 h-5" /> : editing ? 'Save changes' : 'Publish listing'}
              </button>
              <Link to="/dashboard" className="btn-secondary">Cancel</Link>
              {editing && (
                <button type="button" onClick={remove} disabled={busy} className="btn-ghost text-muted ml-auto">
                  Remove listing
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Live preview */}
        <div>
          <div className="sticky top-24">
            <p className="label">How borrowers will see it</p>
            <div className="card p-5">
              <div className="rounded-xl overflow-hidden border border-line relative">
                <BookCover
                  title={form.title || 'Your book title'}
                  author={form.author || 'Author name'}
                  coverUrl={form.coverUrl}
                  size="md"
                />
              </div>
              <div className="flex items-baseline justify-between gap-2 mt-3">
                <h3 className="font-semibold leading-snug line-clamp-1">{form.title || 'Your book title'}</h3>
                <span className="text-[14px] font-bold shrink-0 tabular-nums">
                  {money(form.pricePerDay || 0)}
                  <span className="text-muted font-normal text-[12px]">/day</span>
                </span>
              </div>
              <p className="text-[13px] text-muted">{form.author || 'Author name'}</p>
              <div className="flex items-center gap-2 mt-2 text-[13px]">
                <Rating value={null} count={0} />
                {form.area && (
                  <>
                    <span className="text-line">·</span>
                    <span className="inline-flex items-center gap-1 text-muted">
                      <Icon name="pin" className="w-3.5 h-3.5" />
                      {form.area}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="mt-5 p-5 rounded-xl bg-mist text-[13px] text-muted leading-relaxed">
              <p className="font-semibold text-ink mb-1.5">You stay in control</p>
              Every request comes to you first. Nothing is shared until you accept, and you
              can pause the listing whenever the book is back on your own reading pile.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
