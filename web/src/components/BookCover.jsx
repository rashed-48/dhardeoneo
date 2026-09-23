import { useState } from 'react';

/**
 * Shows the real jacket when the listing has one (fetched by `npm run covers`
 * and served from /covers). Otherwise it falls back to a deterministic
 * monochrome layout derived from the title, so a book with no cover art still
 * looks designed rather than broken.
 */

const hash = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const SIZES = {
  sm: { title: 'text-[11px]', author: 'text-[8px]', pad: 'p-2.5', mono: 'text-[52px]' },
  md: { title: 'text-[15px]', author: 'text-[10px]', pad: 'p-4', mono: 'text-[90px]' },
  lg: { title: 'text-[26px]', author: 'text-[13px]', pad: 'p-7', mono: 'text-[150px]' },
};

export default function BookCover({
  title = '',
  author = '',
  coverUrl = '',
  size = 'md',
  className = '',
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const h = hash(title + author);
  const variant = h % 5;
  const s = SIZES[size] || SIZES.md;
  const initial = title.trim().charAt(0).toUpperCase() || '?';

  const frame = `relative overflow-hidden select-none aspect-[2/3] w-full ${className}`;

  if (coverUrl && !imageFailed) {
    return (
      <div className={`${frame} bg-mist`}>
        <img
          src={coverUrl}
          alt={`Cover of ${title} by ${author}`}
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>
    );
  }

  if (variant === 0) {
    return (
      <div className={`${frame} bg-ink text-paper ${s.pad} flex flex-col justify-between`}>
        <span className="block w-8 h-px bg-paper/60" />
        <div>
          <h4 className={`${s.title} font-extrabold leading-[1.12] uppercase tracking-tight`}>{title}</h4>
          <p className={`${s.author} mt-2 uppercase tracking-[0.18em] text-paper/60`}>{author}</p>
        </div>
      </div>
    );
  }

  if (variant === 1) {
    return (
      <div className={`${frame} bg-paper border-2 border-ink flex flex-col`}>
        <div className={`bg-ink text-paper ${s.pad} pb-3`}>
          <h4 className={`${s.title} font-extrabold leading-[1.12] uppercase tracking-tight`}>{title}</h4>
        </div>
        <div className={`flex-1 ${s.pad} flex items-end`}>
          <p className={`${s.author} uppercase tracking-[0.18em] text-muted`}>{author}</p>
        </div>
      </div>
    );
  }

  if (variant === 2) {
    return (
      <div className={`${frame} bg-mist ${s.pad} flex flex-col justify-end`}>
        <span
          className={`${s.mono} absolute -top-2 -right-1 font-black leading-none text-ink/8 pointer-events-none`}
          aria-hidden="true"
        >
          {initial}
        </span>
        <div className="relative">
          <h4 className={`${s.title} font-extrabold leading-[1.12] tracking-tight`}>{title}</h4>
          <p className={`${s.author} mt-2 uppercase tracking-[0.18em] text-muted`}>{author}</p>
        </div>
      </div>
    );
  }

  if (variant === 3) {
    return (
      <div className={`${frame} bg-paper border border-line ${s.pad} flex flex-col justify-between`}>
        <div className="space-y-1" aria-hidden="true">
          {[10, 7, 4].map((w, i) => (
            <span key={i} className="block h-[3px] bg-ink" style={{ width: `${w * 8}%` }} />
          ))}
        </div>
        <div>
          <h4 className={`${s.title} font-extrabold leading-[1.12] tracking-tight`}>{title}</h4>
          <p className={`${s.author} mt-2 uppercase tracking-[0.18em] text-muted`}>{author}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${frame} bg-ink text-paper flex flex-col justify-center items-center ${s.pad} text-center`}>
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, #fff 0 2px, transparent 2px 9px)',
        }}
        aria-hidden="true"
      />
      <div className="relative">
        <h4 className={`${s.title} font-extrabold leading-[1.12] uppercase tracking-tight`}>{title}</h4>
        <span className="block w-10 h-px bg-paper/60 mx-auto my-3" />
        <p className={`${s.author} uppercase tracking-[0.18em] text-paper/70`}>{author}</p>
      </div>
    </div>
  );
}
