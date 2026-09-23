/**
 * Fetches real cover art for every listing that does not have one.
 *
 * Source: Open Library (openlibrary.org), whose cover images are free to use.
 * Files are downloaded into server/covers/ and served from /covers, so the app
 * works offline afterwards and never hotlinks someone else's bandwidth.
 *
 *   npm run covers          fill in missing covers
 *   npm run covers -- --all re-fetch every cover from scratch
 *
 * Anything with no match on Open Library keeps an empty cover_url and falls
 * back to the generated cover in the UI.
 */
import fs from 'node:fs';
import { db } from './db.js';
import { COVERS_DIR } from './lib/paths.js';
import { findCover, downloadCover } from './lib/openlibrary.js';

const REFETCH_ALL = process.argv.includes('--all');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  fs.mkdirSync(COVERS_DIR, { recursive: true });

  const listings = db
    .prepare(
      REFETCH_ALL
        ? 'SELECT id, title, author, language FROM listings ORDER BY id'
        : "SELECT id, title, author, language FROM listings WHERE cover_url = '' ORDER BY id"
    )
    .all();

  if (listings.length === 0) {
    console.log('Every listing already has a cover. Use --all to re-fetch.');
    return;
  }

  console.log(`Fetching covers for ${listings.length} listing(s)…\n`);

  const update = db.prepare('UPDATE listings SET cover_url = ? WHERE id = ?');
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
      update.run(`/covers/${file}`, book.id);
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

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
