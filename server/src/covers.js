/**
 * Fetches real cover art for every listing that does not have one.
 *
 * Source: Open Library (openlibrary.org), whose cover images are free to use.
 * Files are downloaded into server/covers/ and served from /covers, so the app
 * works offline afterwards and never hotlinks someone else's bandwidth.
 *
 *   npm run covers           fill in missing covers
 *   npm run covers -- --all  re-fetch every cover from scratch
 *   npm run covers -- --seed work from the seed book list, with no database

 * The --seed mode exists for the image build, which bakes cover art in before
 * any database exists. Seeded listing ids are the book list's order, so files
 * named after them still line up when the database is seeded later.
 *
 * Anything with no match on Open Library keeps an empty cover_url and falls
 * back to the generated cover in the UI.
 */
import fs from 'node:fs';
import { COVERS_DIR } from './lib/paths.js';
import { findCover, downloadCover } from './lib/openlibrary.js';

const REFETCH_ALL = process.argv.includes('--all');
const FROM_SEED = process.argv.includes('--seed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  fs.mkdirSync(COVERS_DIR, { recursive: true });

  const listings = FROM_SEED ? await fromSeedList() : await fromDatabase();

  if (listings.length === 0) {
    console.log('Every listing already has a cover. Use --all to re-fetch.');
    return;
  }

  console.log(`Fetching covers for ${listings.length} listing(s)…\n`);

  const cache = new Map(); // the same book listed twice costs one lookup
  let found = 0;
  let missed = 0;

  for (const book of listings) {
    const key = `${book.title}|${book.author}|${book.language}`.toLowerCase();
    const file = `${book.id}.jpg`;

    try {
      let hit = cache.get(key);
      if (hit === undefined) {
        hit = await findCover(book.title, book.author, book.language);
        cache.set(key, hit);
        await sleep(350); // be a good citizen of a free API
      }

      if (!hit) {
        missed++;
        console.log(`  --   ${book.title} — no match, keeping the generated cover`);
        continue;
      }

      const bytes = await downloadCover(hit.coverId, file);
      if (book.update) await book.update(`/covers/${file}`);
      found++;
      console.log(`  ok   ${book.title} (${Math.round(bytes / 1024)} kB)`);
      await sleep(200);
    } catch (err) {
      missed++;
      console.log(`  --   ${book.title} — ${err.message}`);
    }
  }

  console.log(`\nDone. ${found} cover(s) downloaded, ${missed} falling back to generated art.`);
}

/** Build mode: the seed's own book list, numbered the way seeding will number it. */
async function fromSeedList() {
  const { BOOKS } = await import('./seed.js');
  return BOOKS.map(([title, author, , language], i) => ({
    id: i + 1,
    title,
    author,
    language,
  }));
}

/** Development mode: whatever is actually in the database. */
async function fromDatabase() {
  const { db } = await import('./db.js');
  const rows = await db
    .prepare(
      REFETCH_ALL
        ? 'SELECT id, title, author, language FROM listings ORDER BY id'
        : "SELECT id, title, author, language FROM listings WHERE cover_url = '' ORDER BY id"
    )
    .all();
  const update = db.prepare('UPDATE listings SET cover_url = ? WHERE id = ?');
  return rows.map((row) => ({ ...row, update: (url) => update.run(url, row.id) }));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
