import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { db } from './db.js';
import { hashPassword } from './lib/auth.js';
import { AREAS } from './lib/geo.js';
import { quote } from './routes/rentals.js';
import { COVERS_DIR } from './lib/paths.js';

const area = (name) => AREAS.find((a) => a.name === name);

const jitter = (v) => v + (Math.random() - 0.5) * 0.012;

const USERS = [
  ['Ayesha Rahman', 'ayesha@shelf.app', '+8801711000001', 'Dhanmondi', 'Grew up in a house full of paperbacks. Happy to lend, just bring them back dry.'],
  ['Tanvir Hossain', 'tanvir@shelf.app', '+8801711000002', 'Gulshan', 'Business and startup shelf. Pickup from my office lobby.'],
  ['Nusrat Jahan', 'nusrat@shelf.app', '+8801711000003', 'Uttara', 'Bangla literature collector. Careful readers only please.'],
  ['Rafid Karim', 'rafid@shelf.app', '+8801711000004', 'Mirpur', 'CS student. Textbooks and sci-fi.'],
  ['Maliha Chowdhury', 'maliha@shelf.app', '+8801711000005', 'Banani', 'Books should travel. Flexible on dates.'],
  ['Shakib Al Amin', 'shakib@shelf.app', '+8801711000006', 'Mohammadpur', 'History buff, slow reader, huge shelf.'],
  ['Farhana Islam', 'farhana@shelf.app', '+8801711000007', 'Bashundhara', 'Kids books and comics, mostly my daughter’s outgrown pile.'],
  ['Imran Sarker', 'imran@shelf.app', '+8801711000008', 'Old Dhaka', 'Second-hand bookshop family. Everything is cheap here.'],
  ['Priya Das', 'priya@shelf.app', '+8801711000009', 'Shahbagh', 'Near TSC. Literature, poetry, essays.'],
  ['Zayan Mahmud', 'zayan@shelf.app', '+8801711000010', 'Badda', 'Self-help and productivity. Ironically never on time.'],
];

// title, author, category, language, condition, pricePerDay, deposit, minDays, maxDays, ownerIdx, description
const BOOKS = [
  ['Sapiens', 'Yuval Noah Harari', 'History', 'English', 'Like new', 18, 400, 3, 21, 0, 'Hardcover, no marks. One of my favourite reads, glad to pass it around.'],
  ['Atomic Habits', 'James Clear', 'Self-help', 'English', 'Good', 15, 300, 3, 14, 9, 'Slight crease on the spine. Highlighted a few lines in pencil, erasable.'],
  ['The Lean Startup', 'Eric Ries', 'Business', 'English', 'Good', 14, 300, 5, 30, 1, 'Great for anyone building a product. Pickup from Gulshan 2 circle.'],
  ['Zero to One', 'Peter Thiel', 'Business', 'English', 'Like new', 16, 350, 3, 21, 1, 'Short read, finish it in a weekend.'],
  ['Thinking, Fast and Slow', 'Daniel Kahneman', 'Non-fiction', 'English', 'Good', 20, 500, 7, 30, 1, 'Dense but worth it. Take your time with this one.'],
  ['Clean Code', 'Robert C. Martin', 'Academic', 'English', 'Fair', 22, 600, 7, 45, 3, 'My university copy. Margins have notes, cover is worn.'],
  ['Introduction to Algorithms', 'Cormen et al.', 'Academic', 'English', 'Good', 30, 1200, 7, 60, 3, 'CLRS, the big one. Deposit is high because it is expensive to replace.'],
  ['Dune', 'Frank Herbert', 'Fiction', 'English', 'Like new', 17, 400, 5, 30, 3, 'Movie tie-in edition. Sand not included.'],
  ['Project Hail Mary', 'Andy Weir', 'Fiction', 'English', 'Like new', 19, 450, 3, 21, 4, 'Best sci-fi I read last year. No spoilers.'],
  ['The Midnight Library', 'Matt Haig', 'Fiction', 'English', 'Good', 12, 250, 3, 14, 4, 'Light and quick. Good for a slow week.'],
  ['Normal People', 'Sally Rooney', 'Fiction', 'English', 'Good', 11, 250, 3, 14, 4, 'Paperback, read once.'],
  ['A Brief History of Time', 'Stephen Hawking', 'Science', 'English', 'Good', 14, 350, 5, 30, 5, 'Classic. A little sun-faded on the cover.'],
  ['Cosmos', 'Carl Sagan', 'Science', 'English', 'Like new', 18, 400, 5, 30, 5, 'Beautiful illustrated edition, please keep it away from tea.'],
  ['Guns, Germs, and Steel', 'Jared Diamond', 'History', 'English', 'Fair', 13, 300, 7, 30, 5, 'Older print, pages yellowed but all intact.'],
  ['The Silk Roads', 'Peter Frankopan', 'History', 'English', 'Good', 16, 400, 7, 30, 5, 'Big book, big history. Worth the time.'],
  ['লাল শালু', 'Syed Waliullah', 'Bangla Literature', 'Bangla', 'Good', 9, 200, 3, 21, 2, 'Classic Bangla novel. Handle gently, it is an old edition.'],
  ['হিমু সমগ্র', 'Humayun Ahmed', 'Bangla Literature', 'Bangla', 'Good', 10, 250, 5, 30, 2, 'Collected Himu. Comfort reading for a rainy week.'],
  ['পথের পাঁচালী', 'Bibhutibhushan Bandyopadhyay', 'Bangla Literature', 'Bangla', 'Like new', 12, 300, 5, 30, 2, 'Fresh copy from Boi Mela.'],
  ['শেষের কবিতা', 'Rabindranath Tagore', 'Bangla Literature', 'Bangla', 'Good', 8, 150, 3, 21, 8, 'Slim volume, very loved copy.'],
  ['The God of Small Things', 'Arundhati Roy', 'Fiction', 'English', 'Good', 13, 300, 5, 30, 8, 'Booker winner. My copy has a coffee ring on page 40, being honest.'],
  ['Milk and Honey', 'Rupi Kaur', 'Fiction', 'English', 'Like new', 9, 200, 3, 14, 8, 'Poetry, reads in one sitting.'],
  ['Educated', 'Tara Westover', 'Non-fiction', 'English', 'Like new', 16, 350, 5, 21, 0, 'Memoir. Hard to put down.'],
  ['Becoming', 'Michelle Obama', 'Non-fiction', 'English', 'Good', 15, 350, 5, 21, 0, 'Hardcover with dust jacket intact.'],
  ['The Psychology of Money', 'Morgan Housel', 'Business', 'English', 'Like new', 14, 300, 3, 21, 9, 'Short chapters, easy to read on the bus.'],
  ['Deep Work', 'Cal Newport', 'Self-help', 'English', 'Good', 12, 250, 3, 21, 9, 'Changed how I plan my week.'],
  ['Ikigai', 'Héctor García', 'Self-help', 'English', 'Fair', 7, 150, 3, 14, 7, 'Cheap and cheerful. Cover is bent.'],
  ['Rich Dad Poor Dad', 'Robert Kiyosaki', 'Business', 'English', 'Fair', 6, 150, 3, 14, 7, 'Old second-hand copy from our shop.'],
  ['The Alchemist', 'Paulo Coelho', 'Fiction', 'English', 'Good', 7, 150, 3, 14, 7, 'We have several copies, always available.'],
  ['Harry Potter and the Philosopher’s Stone', 'J.K. Rowling', 'Children', 'English', 'Good', 11, 300, 5, 30, 6, 'My daughter outgrew it. Some stickers inside the cover.'],
  ['Matilda', 'Roald Dahl', 'Children', 'English', 'Like new', 9, 200, 3, 21, 6, 'Illustrated edition, barely touched.'],
  ['Persepolis', 'Marjane Satrapi', 'Comics & Graphic', 'English', 'Like new', 15, 350, 3, 21, 6, 'Graphic memoir. Genuinely one of the best.'],
  ['Watchmen', 'Alan Moore', 'Comics & Graphic', 'English', 'Good', 17, 400, 5, 30, 3, 'Deluxe edition, spine is solid.'],
  ['The Selfish Gene', 'Richard Dawkins', 'Science', 'English', 'Good', 13, 300, 7, 30, 5, 'Anniversary edition.'],
  ['Operating System Concepts', 'Silberschatz', 'Academic', 'English', 'Fair', 20, 800, 7, 60, 3, 'The dinosaur book. Exam season favourite.'],
];

const REVIEW_TEXTS = [
  [5, 'Book was exactly as described and Ayesha was easy to coordinate with. Would borrow again.'],
  [5, 'Smooth handover, book in great shape. Highly recommend this lender.'],
  [4, 'Good condition, pickup took a bit of back and forth but all fine in the end.'],
  [5, 'Cheapest one I could find nearby and the copy was clean. Very happy.'],
  [4, 'Nice copy. A few pencil marks inside but the lender had mentioned it upfront.'],
  [3, 'Book was fine, a bit more worn than I expected. Still readable.'],
  [5, 'Ten minutes from my flat, took two minutes to collect. This is how it should work.'],
  [5, 'Lender even extended my dates when I asked. Lovely experience.'],
  [4, 'Returned it late by a day, they were relaxed about it. Good book too.'],
  [5, 'Perfect. Wrapped in paper, no damage at all.'],
];

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - n);
  return iso(d);
};
const daysFromNow = (n) => daysAgo(-n);

function reset() {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec("UPDATE app_meta SET value = '1' WHERE key = 'ledger_cleanup'");
    for (const t of ['payments', 'reviews', 'rentals', 'listings', 'users']) {
      db.exec(`DELETE FROM ${t}`);
      db.exec(`DELETE FROM sqlite_sequence WHERE name = '${t}'`);
    }
    db.exec("UPDATE app_meta SET value = '0' WHERE key = 'ledger_cleanup'");
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function seed() {
  reset();

  const insertUser = db.prepare(
    `INSERT INTO users (name, email, password_hash, phone, area, lat, lng, bio)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const pw = hashPassword('password123');
  const userIds = USERS.map(([name, email, phone, areaName, bio]) => {
    const a = area(areaName);
    return Number(
      insertUser.run(name, email, pw, phone, areaName, jitter(a.lat), jitter(a.lng), bio)
        .lastInsertRowid
    );
  });

  const insertListing = db.prepare(
    `INSERT INTO listings
     (owner_id, title, author, category, language, condition, description,
      price_per_day, deposit, min_days, max_days, area, lat, lng, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'available', ?)`
  );

  const listingIds = BOOKS.map((b, i) => {
    const [title, author, category, language, condition, price, deposit, minD, maxD, ownerIdx, desc] = b;
    const ownerArea = USERS[ownerIdx][3];
    const a = area(ownerArea);
    return Number(
      insertListing.run(
        userIds[ownerIdx], title, author, category, language, condition, desc,
        price, deposit, minD, maxD, ownerArea, jitter(a.lat), jitter(a.lng),
        daysAgo(60 - i)
      ).lastInsertRowid
    );
  });

  // Listing ids are deterministic, so covers fetched earlier still match.
  let reattached = 0;
  const setCover = db.prepare('UPDATE listings SET cover_url = ? WHERE id = ?');
  for (const id of listingIds) {
    if (fs.existsSync(path.join(COVERS_DIR, `${id}.jpg`))) {
      setCover.run(`/covers/${id}.jpg`, id);
      reattached++;
    }
  }

  const insertRental = db.prepare(
    `INSERT INTO rentals
     (listing_id, borrower_id, owner_id, start_date, end_date, days, price_per_day,
      subtotal, service_fee, deposit, total, message, status, created_at, paid_at, settled_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const insertReview = db.prepare(
    `INSERT INTO reviews (rental_id, listing_id, owner_id, reviewer_id, rating, comment, created_at)
     VALUES (?,?,?,?,?,?,?)`
  );
  const insertPayment = db.prepare(
    `INSERT INTO payments
     (rental_id, payer_id, payee_id, kind, amount, status, method, brand, last4, reference, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );

  const CARDS = [['Visa', '4242'], ['Mastercard', '5454'], ['Visa', '1881'], ['Amex', '0005']];
  let ref = 0;
  const nextRef = (p) => `${p}_seed${String(++ref).padStart(6, '0')}`;

  /** A settled rental leaves three rows: the charge, the deposit back, the payout. */
  function settleSeeded(rentalId, borrowerId, ownerId, q, when) {
    const [brand, last4] = CARDS[rentalId % CARDS.length];
    insertPayment.run(rentalId, borrowerId, null, 'rental', q.total, 'succeeded', 'card', brand, last4, nextRef('ch'), when);
    if (q.deposit > 0)
      insertPayment.run(rentalId, null, borrowerId, 'deposit_refund', q.deposit, 'succeeded', 'card', brand, last4, nextRef('re'), when);
    insertPayment.run(rentalId, null, ownerId, 'payout', q.subtotal, 'succeeded', 'transfer', '', '', nextRef('po'), when);
  }

  // A history of completed rentals gives listings and lenders real ratings.
  let reviewCursor = 0;
  let completed = 0;
  for (let i = 0; i < BOOKS.length; i++) {
    const ownerIdx = BOOKS[i][9];
    const howMany = (i % 3) + 1; // 1..3 past rentals per book
    for (let k = 0; k < howMany; k++) {
      let borrowerIdx = (ownerIdx + k + 1 + i) % USERS.length;
      if (borrowerIdx === ownerIdx) borrowerIdx = (borrowerIdx + 1) % USERS.length;

      const days = BOOKS[i][7]; // min_days
      const startedAgo = 20 + k * 25 + (i % 7);
      const q = quote(BOOKS[i][5], days, BOOKS[i][6]);

      const paidAt = daysAgo(startedAgo + 1);
      const settledAt = daysAgo(startedAgo - days);

      const rentalId = Number(
        insertRental.run(
          listingIds[i], userIds[borrowerIdx], userIds[ownerIdx],
          daysAgo(startedAgo), daysAgo(startedAgo - days), days, BOOKS[i][5],
          q.subtotal, q.serviceFee, q.deposit, q.total, '', 'returned',
          daysAgo(startedAgo + 2), paidAt, settledAt
        ).lastInsertRowid
      );
      settleSeeded(rentalId, userIds[borrowerIdx], userIds[ownerIdx], q, settledAt);
      completed++;

      // Leave roughly a fifth of finished rentals unreviewed, like real life.
      if ((i + k) % 5 !== 4) {
        const [rating, comment] = REVIEW_TEXTS[reviewCursor % REVIEW_TEXTS.length];
        reviewCursor++;
        insertReview.run(
          rentalId, listingIds[i], userIds[ownerIdx], userIds[borrowerIdx],
          rating, comment, daysAgo(startedAgo - days - 1)
        );
      }
    }
  }

  // A couple of books are currently out, and a couple of requests are pending.
  const liveQuote = quote(BOOKS[6][5], 14, BOOKS[6][6]);
  const liveId = Number(
    insertRental.run(
      listingIds[6], userIds[4], userIds[BOOKS[6][9]],
      daysAgo(4), daysFromNow(10), 14, BOOKS[6][5],
      liveQuote.subtotal, liveQuote.serviceFee, liveQuote.deposit, liveQuote.total,
      'Need it for my algorithms final.', 'active', daysAgo(6), daysAgo(5), null
    ).lastInsertRowid
  );
  insertPayment.run(
    liveId, userIds[4], null, 'rental', liveQuote.total, 'succeeded', 'card',
    'Visa', '4242', nextRef('ch'), daysAgo(5)
  );
  const pendingQuote = quote(BOOKS[12][5], 10, BOOKS[12][6]);
  insertRental.run(
    listingIds[12], userIds[0], userIds[BOOKS[12][9]],
    daysFromNow(2), daysFromNow(12), 10, BOOKS[12][5],
    pendingQuote.subtotal, pendingQuote.serviceFee, pendingQuote.deposit, pendingQuote.total,
    'Can I pick it up on Friday evening?', 'requested', daysAgo(1), null, null
  );

  // One accepted-but-unpaid rental so the checkout screen has something to open.
  const awaitingQuote = quote(BOOKS[8][5], 7, BOOKS[8][6]);
  insertRental.run(
    listingIds[8], userIds[0], userIds[BOOKS[8][9]],
    daysFromNow(1), daysFromNow(8), 7, BOOKS[8][5],
    awaitingQuote.subtotal, awaitingQuote.serviceFee, awaitingQuote.deposit, awaitingQuote.total,
    'Happy to collect any evening this week.', 'approved', daysAgo(2), null, null
  );

  const counts = {
    covers: reattached,
    payments: db.prepare('SELECT COUNT(*) AS n FROM payments').get().n,
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    listings: db.prepare('SELECT COUNT(*) AS n FROM listings').get().n,
    rentals: db.prepare('SELECT COUNT(*) AS n FROM rentals').get().n,
    reviews: db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n,
  };

  console.log('Seeded Shelf:', counts, `(${completed} completed rentals)`);
  console.log('Demo login  ->  ayesha@shelf.app / password123');
  return counts;
}

// Only seed when run as a script — importing this module must have no effect.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) seed();
