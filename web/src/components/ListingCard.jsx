import { Link } from 'react-router-dom';
import BookCover from './BookCover';
import { Rating, Icon } from './ui';
import { money, perDay, km } from '../lib/format';

/** Grid tile. Price, rating and distance sit together — the three things borrowers compare. */
export default function ListingCard({ listing }) {
  const distance = km(listing.distanceKm);

  return (
    <Link
      to={`/book/${listing.id}`}
      className="group block focus:outline-none"
      aria-label={`${listing.title} by ${listing.author}`}
    >
      <div className="relative rounded-xl overflow-hidden border border-line group-hover:border-ink transition-colors">
        <BookCover title={listing.title} author={listing.author} coverUrl={listing.coverUrl} size="md" />
        {listing.lentOut && (
          <span className="absolute top-3 left-3 bg-paper text-ink text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md">
            Lent out
          </span>
        )}
      </div>

      <div className="pt-3">
        {/* Price sits beside the title so a column of cards is scannable by cost. */}
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-semibold text-[15px] leading-snug line-clamp-1 group-hover:underline decoration-1 underline-offset-2">
            {listing.title}
          </h3>
          <span className="text-[14px] font-bold shrink-0 tabular-nums">
            {money(listing.pricePerDay)}
            <span className="text-muted font-normal text-[12px]">/day</span>
          </span>
        </div>
        <p className="text-[13px] text-muted line-clamp-1 mt-0.5">{listing.author}</p>

        <div className="flex items-center gap-2 mt-2 text-[13px]">
          <Rating value={listing.rating} count={listing.reviewCount} />
          {distance && (
            <>
              <span className="text-line" aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-muted">
                <Icon name="pin" className="w-3.5 h-3.5" />
                {distance}
              </span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

/** Dense row used in search results on wide screens. */
export function ListingRow({ listing }) {
  const distance = km(listing.distanceKm);

  return (
    <Link
      to={`/book/${listing.id}`}
      className="group flex gap-4 p-4 rounded-xl border border-line hover:border-ink transition-colors"
    >
      <div className="w-20 shrink-0 rounded-lg overflow-hidden">
        <BookCover title={listing.title} author={listing.author} coverUrl={listing.coverUrl} size="sm" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-semibold leading-snug truncate group-hover:underline decoration-1 underline-offset-2">
              {listing.title}
            </h3>
            <p className="text-[13px] text-muted truncate">{listing.author}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="font-bold">{perDay(listing.pricePerDay)}</div>
            {listing.deposit > 0 && (
              <div className="text-[11px] text-muted">+ deposit</div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2.5 text-[13px]">
          <Rating value={listing.rating} count={listing.reviewCount} />
          {distance && (
            <span className="inline-flex items-center gap-1 text-muted">
              <Icon name="pin" className="w-3.5 h-3.5" />
              {distance} · {listing.area}
            </span>
          )}
          <span className="tag">{listing.condition}</span>
          {listing.lentOut && <span className="tag">Lent out</span>}
        </div>
      </div>
    </Link>
  );
}
