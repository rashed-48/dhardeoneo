import fs from 'node:fs';
import path from 'node:path';
import { COVERS_DIR } from './paths.js';

/**
 * Thin client for Open Library's search and cover endpoints.
 *
 * Covers are always copied into COVERS_DIR and served from our own /covers
 * route — the app never points an <img> at someone else's server.
 */

const UA = 'Shelf/1.0 (book lending demo; contact via localhost)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Open Library is catalogued in Latin script, so Bangla titles and informal
 * author credits need a transliterated search term to match.
 */
export const SEARCH_ALIASES = {
  'লাল শালু': { title: 'Tree Without Roots', author: 'Syed Waliullah' },
  'হিমু সমগ্র': { title: 'Himu', author: 'Humayun Ahmed' },
  'পথের পাঁচালী': { title: 'Pather Panchali', author: 'Bibhutibhushan Banerjee' },
  'শেষের কবিতা': { title: 'Shesher Kabita', author: 'Rabindranath Tagore' },
  'Introduction to Algorithms': { title: 'Introduction to Algorithms', author: 'Thomas H. Cormen' },
};

async function search(params) {
  const res = await fetch('https://openlibrary.org/search.json?' + new URLSearchParams(params), {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.docs || []).find((d) => d.cover_i) || null;
}

/**
 * @param {string} language listing language, used to prefer an edition in the
 *   same language — without it an English title can come back as, say, the
 *   French edition.
 * @returns {Promise<{coverId:number,title:string,author:string}|null>}
 */
export async function findCover(rawTitle, rawAuthor = '', language = 'English') {
  const alias = SEARCH_ALIASES[rawTitle];
  const title = alias?.title || rawTitle;
  const author = alias?.author || rawAuthor;
  const fields = 'title,author_name,cover_i';
  const lang = { English: 'eng', Bangla: 'ben' }[language];

  // Narrowest query first, then progressively looser ones.
  const attempts = [
    author && lang ? { title, author, language: lang, limit: '5', fields } : null,
    author ? { title, author, limit: '5', fields } : null,
    { q: `${title} ${author}`.trim(), limit: '5', fields },
    { title, limit: '5', fields },
  ].filter(Boolean);

  for (const params of attempts) {
    const hit = await search(params);
    if (hit)
      return {
        coverId: hit.cover_i,
        title: hit.title || title,
        author: hit.author_name?.[0] || author,
      };
    await sleep(200);
  }
  return null;
}

/** Downloads a cover into COVERS_DIR under `fileName`. Returns bytes written. */
export async function downloadCover(coverId, fileName) {
  const res = await fetch(`https://covers.openlibrary.org/b/id/${coverId}-L.jpg`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`cover ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  // Open Library answers a missing cover with a tiny placeholder.
  if (buffer.length < 3000) throw new Error('placeholder image');

  fs.mkdirSync(COVERS_DIR, { recursive: true });
  fs.writeFileSync(path.join(COVERS_DIR, fileName), buffer);
  return buffer.length;
}

/**
 * Finds and caches a cover for a title, reusing the file if it is already on
 * disk. Returns the public path, or null when nothing matched.
 */
export async function cacheCoverFor(title, author, language) {
  const hit = await findCover(title, author, language);
  if (!hit) return null;

  const fileName = `ol-${hit.coverId}.jpg`;
  const onDisk = path.join(COVERS_DIR, fileName);
  if (!fs.existsSync(onDisk)) await downloadCover(hit.coverId, fileName);

  return { coverUrl: `/covers/${fileName}`, matchedTitle: hit.title, matchedAuthor: hit.author };
}
