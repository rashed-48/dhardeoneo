import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../store/AppContext';
import ListingCard, { ListingRow } from '../components/ListingCard';
import LocationSheet from '../components/LocationSheet';
import { Icon, Empty, Loading, Sheet, Field, StarRow } from '../components/ui';
import { money, plural } from '../lib/format';

const SORTS = [
  { value: 'best', label: 'Best match' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'distance', label: 'Closest first' },
  { value: 'newest', label: 'Newly listed' },
];

const DISTANCES = [
  { value: '', label: 'Any distance' },
  { value: '2', label: 'Within 2 km' },
  { value: '5', label: 'Within 5 km' },
  { value: '10', label: 'Within 10 km' },
];

const RATINGS = [
  { value: '', label: 'Any rating' },
  { value: '4', label: '4.0+' },
  { value: '4.5', label: '4.5+' },
];

export default function Browse() {
  const { place, config } = useApp();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [view, setView] = useState('grid');
  const [draft, setDraft] = useState(params.get('q') || '');

  const filters = useMemo(
    () => ({
      q: params.get('q') || '',
      category: params.get('category') || '',
      maxPrice: params.get('maxPrice') || '',
      minRating: params.get('minRating') || '',
      maxDistance: params.get('maxDistance') || '',
      sort: params.get('sort') || 'best',
      availableOnly: params.get('availableOnly') || '',
    }),
    [params]
  );

  useEffect(() => setDraft(filters.q), [filters.q]);

  useEffect(() => {
    api.listingMeta().then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    setData(null);
    api
      .listings({ ...filters, lat: place.lat, lng: place.lng })
      .then((r) => live && setData(r))
      .catch(() => live && setData({ count: 0, items: [] }));
    return () => {
      live = false;
    };
  }, [filters, place.lat, place.lng]);

  const update = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      v === '' || v == null ? next.delete(k) : next.set(k, String(v));
    }
    setParams(next, { replace: true });
  };

  const clearAll = () => setParams(new URLSearchParams(), { replace: true });

  const activeCount = ['category', 'maxPrice', 'minRating', 'maxDistance', 'availableOnly']
    .filter((k) => filters[k]).length;

  const maxPrice = meta?.priceRange?.max ?? 50;

  return (
    <div className="max-w-7xl mx-auto px-5 py-8">
      {/* Search bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: draft.trim() });
        }}
        className="flex gap-3"
      >
        <div className="relative flex-1">
          <Icon name="search" className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search a title, author or subject"
            className="input pl-12"
            aria-label="Search books"
          />
          {draft && (
            <button
              type="button"
              onClick={() => {
                setDraft('');
                update({ q: '' });
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center rounded-full hover:bg-line"
              aria-label="Clear search"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <button type="submit" className="btn-primary px-7 hidden sm:inline-flex">Search</button>
      </form>

      {/* Filter rail */}
      <div className="flex items-center gap-2.5 mt-5 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setFiltersOpen(true)}
          className={`chip ${activeCount ? 'chip-active' : ''}`}
        >
          <Icon name="sliders" className="w-4 h-4" />
          Filters{activeCount ? ` · ${activeCount}` : ''}
        </button>

        <button onClick={() => setLocationOpen(true)} className="chip">
          <Icon name="pin" className="w-4 h-4" />
          {place.name}
        </button>

        <span className="w-px h-6 bg-line shrink-0" aria-hidden="true" />

        {meta?.categories
          .filter((c) => c.count > 0)
          .map((c) => (
            <button
              key={c.name}
              onClick={() => update({ category: filters.category === c.name ? '' : c.name })}
              className={`chip ${filters.category === c.name ? 'chip-active' : ''}`}
            >
              {c.name}
            </button>
          ))}
      </div>

      {/* Result header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-7 pb-4 border-b border-line">
        <p className="text-[15px]">
          {data ? (
            <>
              <span className="font-bold">{plural(data.count, 'book')}</span>
              <span className="text-muted"> available near {place.name}</span>
            </>
          ) : (
            <span className="text-muted">Searching…</span>
          )}
        </p>

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="sort">Sort by</label>
          <select
            id="sort"
            value={filters.sort}
            onChange={(e) => update({ sort: e.target.value })}
            className="input h-10 w-auto text-sm bg-paper border border-line"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          <div className="hidden sm:flex items-center bg-mist rounded-lg p-1">
            {['grid', 'list'].map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-label={`${v} view`}
                className={`w-8 h-8 grid place-items-center rounded-md transition-colors ${
                  view === v ? 'bg-paper shadow-sm' : 'text-muted hover:text-ink'
                }`}
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  {v === 'grid' ? (
                    <>
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <rect x="14" y="14" width="7" height="7" rx="1" />
                    </>
                  ) : (
                    <path d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Active filter summary */}
      {activeCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {filters.category && (
            <Pill label={filters.category} onClear={() => update({ category: '' })} />
          )}
          {filters.maxPrice && (
            <Pill label={`Under ${money(filters.maxPrice)}/day`} onClear={() => update({ maxPrice: '' })} />
          )}
          {filters.minRating && (
            <Pill label={`${filters.minRating}+ rating`} onClear={() => update({ minRating: '' })} />
          )}
          {filters.maxDistance && (
            <Pill label={`Within ${filters.maxDistance} km`} onClear={() => update({ maxDistance: '' })} />
          )}
          {filters.availableOnly && (
            <Pill label="Available now" onClear={() => update({ availableOnly: '' })} />
          )}
          <button onClick={clearAll} className="text-[13px] font-medium underline underline-offset-2 ml-1">
            Clear all
          </button>
        </div>
      )}

      {/* Results */}
      {!data ? (
        <Loading label="Finding books" />
      ) : data.items.length === 0 ? (
        <Empty
          title="No books match that"
          body="Try a wider distance, a higher price, or a different spelling."
          action={<button onClick={clearAll} className="btn-primary">Reset filters</button>}
        />
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-5 gap-y-8 mt-7 rise">
          {data.items.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3 mt-7 rise">
          {data.items.map((l) => (
            <ListingRow key={l.id} listing={l} />
          ))}
        </div>
      )}

      <LocationSheet open={locationOpen} onClose={() => setLocationOpen(false)} />

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <div className="space-y-7">
          <Field label="Category">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => update({ category: '' })}
                className={`chip ${!filters.category ? 'chip-active' : ''}`}
              >
                All
              </button>
              {(meta?.categories || config.categories.map((name) => ({ name, count: 1 })))
                .filter((c) => c.count > 0)
                .map((c) => (
                  <button
                    key={c.name}
                    onClick={() => update({ category: filters.category === c.name ? '' : c.name })}
                    className={`chip ${filters.category === c.name ? 'chip-active' : ''}`}
                  >
                    {c.name}
                  </button>
                ))}
            </div>
          </Field>

          <Field
            label="Maximum price per day"
            hint={filters.maxPrice ? `Showing books up to ${money(filters.maxPrice)} a day` : 'Any price'}
          >
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="1"
                max={maxPrice}
                step="1"
                value={filters.maxPrice || maxPrice}
                onChange={(e) =>
                  update({ maxPrice: Number(e.target.value) >= maxPrice ? '' : e.target.value })
                }
                className="flex-1 accent-black"
              />
              <span className="w-20 text-right font-bold tabular-nums">
                {filters.maxPrice ? money(filters.maxPrice) : 'Any'}
              </span>
            </div>
          </Field>

          <Field label="Minimum rating">
            <div className="flex flex-wrap gap-2">
              {RATINGS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => update({ minRating: r.value })}
                  className={`chip ${filters.minRating === r.value ? 'chip-active' : ''}`}
                >
                  {r.value && <StarRow value={Number(r.value)} size="w-3 h-3" />}
                  {r.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label={`Distance from ${place.name}`}>
            <div className="flex flex-wrap gap-2">
              {DISTANCES.map((d) => (
                <button
                  key={d.value}
                  onClick={() => update({ maxDistance: d.value })}
                  className={`chip ${filters.maxDistance === d.value ? 'chip-active' : ''}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setFiltersOpen(false);
                setLocationOpen(true);
              }}
              className="mt-3 text-[13px] font-medium underline underline-offset-2"
            >
              Change my location
            </button>
          </Field>

          <Field label="Availability">
            <button
              onClick={() => update({ availableOnly: filters.availableOnly ? '' : 'true' })}
              className={`chip ${filters.availableOnly ? 'chip-active' : ''}`}
            >
              <Icon name="check" className="w-4 h-4" />
              Available right now
            </button>
          </Field>

          <div className="flex gap-3 pt-2">
            <button onClick={clearAll} className="btn-secondary flex-1">Clear all</button>
            <button onClick={() => setFiltersOpen(false)} className="btn-primary flex-1">
              Show {data ? data.count : ''} results
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function Pill({ label, onClear }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-8 pl-3 pr-2 rounded-full bg-ink text-paper text-[13px] font-medium">
      {label}
      <button onClick={onClear} aria-label={`Remove ${label}`} className="w-5 h-5 grid place-items-center rounded-full hover:bg-paper/20">
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}
