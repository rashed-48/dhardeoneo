import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../store/AppContext';
import ListingCard from '../components/ListingCard';
import BookCover from '../components/BookCover';
import LocationSheet from '../components/LocationSheet';
import { Icon, Spinner } from '../components/ui';


export default function Home() {
  const { place, user } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [near, setNear] = useState(null);
  const [cheap, setCheap] = useState(null);
  const [meta, setMeta] = useState(null);
  const [locationOpen, setLocationOpen] = useState(false);

  useEffect(() => {
    api.listingMeta().then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    const origin = { lat: place.lat, lng: place.lng };
    setNear(null);
    setCheap(null);
    api.listings({ ...origin, sort: 'distance', limit: 6, availableOnly: true })
      .then((r) => setNear(r.items))
      .catch(() => setNear([]));
    api.listings({ ...origin, sort: 'price_asc', limit: 6, availableOnly: true })
      .then((r) => setCheap(r.items))
      .catch(() => setCheap([]));
  }, [place.lat, place.lng]);

  const submit = (e) => {
    e.preventDefault();
    navigate(`/browse?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div>
      {/* Hero */}
      <section className="border-b border-line">
        <div className="max-w-7xl mx-auto px-5 py-14 sm:py-20 grid lg:grid-cols-2 gap-12 items-center">
          <div className="rise">
            <h1 className="text-[40px] sm:text-[56px] lg:text-[64px] font-extrabold leading-[0.98]">
              Borrow the book.
              <br />
              Not the bookshop.
            </h1>
            <p className="mt-6 text-lg text-muted max-w-md leading-relaxed">
              Rent books by the day from people on your street. Compare price, rating
              and distance — then walk over and pick it up.
            </p>

            <form onSubmit={submit} className="mt-8 flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Icon name="search" className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search a title, author or subject"
                  className="input pl-12"
                  aria-label="Search books"
                />
              </div>
              <button type="submit" className="btn-primary px-8">
                Search
              </button>
            </form>

            <button
              onClick={() => setLocationOpen(true)}
              className="mt-4 inline-flex items-center gap-2 text-[14px] text-muted hover:text-ink transition-colors"
            >
              <Icon name="pin" className="w-4 h-4" />
              Searching near <span className="font-semibold text-ink underline underline-offset-2">{place.name}</span>
              <span aria-hidden="true">·</span> change
            </button>

            {meta && (
              <div className="mt-10 flex items-center gap-8">
                <Stat value={meta.totalBooks} label="books on loan nearby" />
                <span className="w-px h-10 bg-line" aria-hidden="true" />
                <Stat value={meta.totalLenders} label="lenders in your city" />
              </div>
            )}
          </div>

          {/* A tilted stack of generated covers, no imagery needed. */}
          <div className="hidden lg:block relative h-[420px]">
            {(near || []).slice(0, 3).map((l, i) => (
              <Link
                key={l.id}
                to={`/book/${l.id}`}
                className="absolute w-[200px] rounded-xl overflow-hidden border border-line shadow-xl
                           transition-transform duration-300 hover:-translate-y-2 hover:z-10"
                style={{
                  left: `${i * 150}px`,
                  top: `${i * 26}px`,
                  transform: `rotate(${(i - 1) * 4}deg)`,
                }}
              >
                <BookCover title={l.title} author={l.author} coverUrl={l.coverUrl} size="md" />
              </Link>
            ))}
            {!near && (
              <div className="absolute inset-0 grid place-items-center text-muted">
                <Spinner />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Categories */}
      {meta && (
        <section className="max-w-7xl mx-auto px-5 py-10 border-b border-line">
          <div className="flex gap-2.5 overflow-x-auto no-scrollbar">
            {meta.categories
              .filter((c) => c.count > 0)
              .map((c) => (
                <Link key={c.name} to={`/browse?category=${encodeURIComponent(c.name)}`} className="chip">
                  {c.name}
                  <span className="text-muted">{c.count}</span>
                </Link>
              ))}
          </div>
        </section>
      )}

      <Rail
        title="Closest to you"
        subtitle={`Pickup within walking distance of ${place.name}`}
        to={`/browse?sort=distance`}
        items={near}
      />

      <Rail
        title="Cheapest per day"
        subtitle="Lowest daily rate, whatever the distance"
        to="/browse?sort=price_asc"
        items={cheap}
      />

      {/* How it works */}
      <section className="max-w-7xl mx-auto px-5 py-16 border-t border-line">
        <h2 className="text-3xl font-extrabold mb-10">How it works</h2>
        <div className="grid sm:grid-cols-3 gap-10">
          <Step n="1" title="Find it near you" body="Search a title and sort by price, rating or distance from wherever you are." />
          <Step n="2" title="Ask for the days you need" body="Pick a start date and a number of days. You see the full cost, fee and refundable deposit up front." />
          <Step n="3" title="Collect, read, return" body="Once the lender accepts you get their contact details. Return on time and leave a review." />
        </div>
      </section>

      {/* Lender CTA */}
      <section className="bg-ink text-paper">
        <div className="max-w-7xl mx-auto px-5 py-16 sm:py-20 grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-[34px] sm:text-[44px] font-extrabold leading-[1.02]">
              Your shelf is doing nothing.
              <br />
              Put it to work.
            </h2>
            <p className="mt-5 text-paper/70 text-lg max-w-md leading-relaxed">
              Set your own daily rate and deposit. Accept the requests you like, decline
              the rest. Your address stays hidden until you accept.
            </p>
          </div>
          <div className="lg:justify-self-end">
            <Link to={user ? '/lend' : '/signup'} className="btn bg-paper text-ink hover:bg-mist px-8">
              List a book
              <Icon name="arrow" className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      <LocationSheet open={locationOpen} onClose={() => setLocationOpen(false)} />
    </div>
  );
}

function Stat({ value, label }) {
  return (
    <div>
      <div className="text-3xl font-extrabold">{value}</div>
      <div className="text-[13px] text-muted mt-0.5 max-w-[140px] leading-snug">{label}</div>
    </div>
  );
}

function Step({ n, title, body }) {
  return (
    <div>
      <div className="w-9 h-9 rounded-full bg-ink text-paper grid place-items-center font-bold text-sm mb-4">
        {n}
      </div>
      <h3 className="text-lg font-bold mb-2">{title}</h3>
      <p className="text-muted leading-relaxed text-[15px]">{body}</p>
    </div>
  );
}

function Rail({ title, subtitle, to, items }) {
  return (
    <section className="max-w-7xl mx-auto px-5 py-12">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold">{title}</h2>
          <p className="text-muted text-[15px] mt-1">{subtitle}</p>
        </div>
        <Link to={to} className="btn-ghost btn-sm shrink-0">
          See all <Icon name="arrow" className="w-4 h-4" />
        </Link>
      </div>

      {!items ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="aspect-[2/3] bg-mist rounded-xl" />
              <div className="h-3.5 bg-mist rounded mt-3 w-4/5" />
              <div className="h-3 bg-mist rounded mt-2 w-3/5" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted">Nothing here yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-5">
          {items.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </section>
  );
}
