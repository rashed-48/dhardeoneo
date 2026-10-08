# Shelf

[![CI](https://github.com/rashed-48/dhardeoneo/actions/workflows/ci.yml/badge.svg)](https://github.com/rashed-48/dhardeoneo/actions/workflows/ci.yml)

**[Live demo →](https://shelf-he9s.onrender.com)**  ·  sign in as `ayesha@shelf.app` / `password123`

> Running on a free instance that sleeps after 15 minutes idle, so the first request may take
> up to a minute to wake it. Payments are simulated — see [Payments](#payments). Every seeded
> account shares that password, so treat the demo as public.

A peer-to-peer book lending marketplace. People list books they own with a **price per day**,
and borrowers nearby find them, **compare on price, rating and distance**, request the book
for a set number of days, pay once the lender accepts, collect it in person, return it, and
leave a review.

## Run it

Shelf keeps its data in **Postgres**, so you need one running. The quickest is Docker:

```bash
npm run setup    # installs server and web dependencies
npm run db:dev   # Postgres 17 in Docker on :5433 (npm run db:stop to stop it)

cp .env.example server/.env          # then set DATABASE_URL and SHELF_SECRET
npm run seed     # creates the schema and the demo data
npm run covers   # downloads cover art

npm run dev      # API on :4000, web on :5173
npm test         # unit + API tests
```

For `DATABASE_URL`, the container above is `postgres://shelf:devpass@localhost:5433/shelf`.
Any Postgres works — a local install or a hosted one such as Neon.

`server/.env` is loaded automatically by the npm scripts (Node's own
`--env-file-if-exists`, so no dotenv dependency and no failure when the file is absent).
It is gitignored; in production the host injects these variables instead.

Then open <http://localhost:5173>.

Demo account: **ayesha@shelf.app** / **password123** (the login screen has a
"Use a demo account" button). Every seeded lender uses the same password. Ayesha has a rental
waiting to be paid for, so the checkout screen is one click away.

Other scripts: `npm run seed` resets the demo data, `npm run covers` fills in missing cover
art (`-- --all` re-fetches everything, `-- --seed` works from the seed book list with no
database — that is what the image build uses), `npm run build` builds the frontend, and
`npm run dev:api` / `npm run dev:web` run one side only.

## Tests

```bash
npm test            # unit + API integration — fast, needs nothing running
npm run test:browser  # drives the production build in headless Chrome
npm run test:all      # both
```

Both suites need Postgres. They create their own throwaway database per run, so they never
touch development data; set `SHELF_TEST_DATABASE_URL` if yours is not the container above.

`npm test` runs two files. [`core.test.js`](server/test/core.test.js) unit-tests the pure
rules — the payment simulator, quote arithmetic, calendar dates, distance, password
hashing, and the session-refresh decision. [`api.test.js`](server/test/api.test.js) boots the real server in a
child process against a throwaway database on a spare port and exercises the HTTP API, so it
needs no running server and never touches development data.

The rental and payment state machine is the part of this app most expensive to get wrong, so
it is covered transition by transition: payment is refused before acceptance, handover is
refused before payment, return is refused before handover, a declined card leaves the rental
untouched, paying twice is refused, settlement pays the deposit and the rent exactly once and
is safe to retry, cancelling a paid rental refunds everything, and every action is scoped to
the two people involved. Each test publishes its own book rather than competing over seeded
stock, and sessions are reused so the suite stays inside the production rate limits.

[`test/browser.mjs`](test/browser.mjs) covers what only a real browser shows: that the session
cookie is unreachable from JavaScript, that checkout survives a declined card and then
succeeds, that a lapsed session redirects to login with an explanation and returns you to the
page you wanted, and that neither signed-out browsing nor a wrong password is mistaken for an
expiry. It skips with a message if Chrome is not installed (`CHROME_PATH` overrides the
lookup), and removes its profile directory afterwards.

Passwords are hashed with scrypt on libuv's thread pool, never with the synchronous form.
That matters more than it sounds: scrypt is deliberately slow, so hashing on the event loop
freezes the whole server for its duration. Measured with eight concurrent sign-ins, an
unrelated `/api/health` request took **630 ms** synchronously versus **2.6 ms** asynchronously,
and the sign-ins themselves finished in 205 ms rather than 664 ms. A test asserts both
functions stay thenable so a revert to `scryptSync` fails loudly instead of quietly costing
throughput.

Login also hashes against a dummy value when the email is unknown, so a missing account costs
the same work as a wrong password and response time cannot be used to enumerate registered
emails.

Both suites run on every push and pull request via
[GitHub Actions](.github/workflows/ci.yml): one job for the unit and API tests against a
Postgres service container, a second for the browser suite. The browser job fetches cover art
first, since it is not committed, and tolerates a bad day at Open Library rather than
reporting a broken build.

```bash
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit over the JavaScript
npm run check      # lint, types and tests together
```

Type checking uses TypeScript's `checkJs` over plain JavaScript — no `.ts` files, no build
step. It reads the JSDoc already in the source and infers the rest, which catches typos,
wrong argument counts and properties that cannot exist, without asking anyone to annotate a
codebase that works. `strict` is off on purpose: it would report thousands of "possibly
undefined" results already guarded a line above, and that noise would bury the real findings.

[`types/express.d.ts`](types/express.d.ts) declares the `req.user` that `attachUser` sets,
which writes the middleware's contract down somewhere checkable.

Two deliberate gaps. React components are not type-checked yet: a destructured prop reads as
required, so it needs a JSDoc block per component — annotation work rather than a bug hunt,
and a permanently red command teaches everyone to ignore it. And seven effects clear state
before an async fetch or seed a form field from the signed-in user, which `eslint` reports as
warnings; both cost an extra render pass rather than being wrong.

## How the product works

**Borrower**
1. Sets a location — current GPS position or an area from the picker. Every distance in the
   app is measured from that point.
2. Searches and filters: text, category, max price per day, minimum rating, max distance,
   available-now. Sorts by best match, price, rating, distance or newest.
3. Picks a start date and a number of days. The full bill — daily rate × days, service fee,
   refundable deposit — is shown before anything is sent. Nothing is charged yet.
4. When the lender accepts, pays by card to confirm the dates.
5. Collects, reads, returns, reviews.

**Lender**
1. Lists a book, setting the daily rate, deposit, and the minimum and maximum lending period.
2. Gets the request and accepts or declines it. Accepting one request auto-declines others
   that overlap the same dates.
3. Once the borrower has paid, marks the book handed over, then returned.
4. The rent lands as a payout; the deposit goes back to the borrower automatically.

**Privacy.** Phone numbers are stripped from API responses until the lender accepts. Only the
area and distance are public; exact listing coordinates stay server-side. Shelf does not collect a
street address, so borrower and lender agree the precise pickup point after acceptance.

**Reviews.** Only the borrower on a rental that reached `returned` can review it, and only
once. That means every rating on the site comes from a completed loan.

### Ranking

`sort=best` blends the three things borrowers actually compare, so a cheap, well-reviewed
book ten minutes away beats an expensive unrated one across the city:

```
0.40 × rating  +  0.25 × price decay  +  0.25 × proximity  +  0.10 × review volume
```

Unrated books are scored at 3.8/5 rather than 0, so new listings are not buried.
See `score()` in [server/src/routes/listings.js](server/src/routes/listings.js).

## Payments

Money is modelled as an append-only ledger. Rentals never store a balance — every figure the
UI shows (paid, refunded, paid out) is derived from the `payments` table, so the numbers
cannot drift from what actually happened. Database triggers reject ledger updates and deletes in
normal operation; the development seed temporarily unlocks them only while resetting demo data.

| When | Row written | Who |
|---|---|---|
| Borrower pays an accepted rental | `rental` — rent + fee + deposit | borrower → platform |
| Book is returned | `deposit_refund` | platform → borrower |
| Book is returned | `payout` — the rent | platform → lender |
| Paid rental is cancelled | `cancellation_refund` — everything | platform → borrower |

The platform keeps the service fee. Failed attempts are written to the ledger too, so a
declined card leaves a trail without touching the rental's state.

Rules the server enforces: only the borrower can pay, only for a rental the lender has
accepted, only once, and the lender **cannot mark a book handed over until it is paid for**.

### The gateway is simulated

There are no payment-provider credentials in this project, so
[server/src/lib/payments.js](server/src/lib/payments.js) is a stand-in: **no real money moves.**
It is not a stub, though — it runs the Luhn checksum, validates expiry and CVC length by card
brand, and returns the same `{ ok, reference, brand, last4, failureReason }` shape a real
provider would, so every branch above is exercised. Test cards:

| Number | Result |
|---|---|
| `4242 4242 4242 4242` | succeeds |
| `4000 0000 0000 0002` | declined by issuer |
| `4000 0000 0009 0003` | insufficient funds |

Card numbers are passed straight to the gateway and never persisted — only the brand and last
four digits are stored. To go live, swap `charge`/`refund`/`payout` for a real PSP (Stripe,
SSLCOMMERZ, bKash) and keep the return shape; nothing above that file changes. A production
integration would also tokenise the card in the browser so the PAN never reaches this server.

This repository intentionally remains a **demo**: the bundled gateway does not move money and
requires no paid account. Do not collect real card details or present this checkout as real until
a tokenising payment provider, provider idempotency keys, webhook reconciliation, and payout
onboarding are in place.

## Cover art

`npm run covers` fetches real jackets from [Open Library](https://openlibrary.org) and stores
them in `server/covers/`, served from our own `/covers` route — the app never hotlinks
someone else's bandwidth and works offline afterwards. All 34 seeded books have real covers
(~1.5 MB total). The files are gitignored because they are fetched, not authored.

Two details that took a second pass: the search prefers an edition in the **listing's own
language**, otherwise an English title can come back as the French edition; and Bangla titles
need a transliterated search term, since Open Library is catalogued in Latin script
(`SEARCH_ALIASES` in [server/src/lib/openlibrary.js](server/src/lib/openlibrary.js)).

When a lender adds their own book, **Find the real cover** on the lend form looks it up and
caches it the same way. Anything with no match falls back to `BookCover`, which hashes the
title into one of five monochrome layouts — so a book without art still looks designed rather
than broken.

## Deploying

The whole thing runs as **one container on one port**: Express serves the API, the cover
images and the built SPA together, so there is no CORS setup, no second service and no
separate static host.

```bash
npm run preview     # build + run exactly as production does, on http://localhost:4000
```

### First deploy

```bash
git add -A && git commit -m "Shelf"
git remote add origin git@github.com:<you>/shelf.git && git push -u origin main
```

The container holds no state, so the database is a separate managed service. Create it
first, then point the app at it.

**1. A Postgres database.** [Neon](https://neon.tech) has a free tier that suspends when idle
and resumes on the next connection, with no manual step. Create a project, pick the region
closest to where the app will run, and copy the connection string.

**2. The app.** On Render: New > Blueprint, point it at the repo.
[`render.yaml`](render.yaml) declares the Docker build, the health check and a generated
`SHELF_SECRET`; paste the Neon connection string into `DATABASE_URL` and that is all.

Any other Docker host (Fly.io, Railway, Koyeb, a VPS) works the same way — build the
[`Dockerfile`](Dockerfile) and give it `DATABASE_URL` and `SHELF_SECRET`.
[`fly.toml`](fly.toml) is set up for Fly.

**Keep the app and the database in the same region.** Several endpoints run a handful of
queries in sequence; inside one region that is about a millisecond each, across an ocean it
is a few hundred.

### What the container does on boot

1. Copies bundled cover art onto the data directory if one is mounted.
2. **Creates the schema if it is missing**, so a new database needs no migration step.
3. **Seeds itself if the database is empty**, so a brand-new deploy comes up with all 34
   books rather than a blank page.
4. Links any listing that has a cover file but no record of it.

Because the data lives in Postgres rather than on the container's disk, a redeploy or a
restart keeps it — which is what makes a free instance with no disk workable. Cover art
fetched *after* deploy is still written locally and does not survive without a volume;
anything missing falls back to generated art.

### Environment

| Variable | Needed | Meaning |
|---|---|---|
| `SHELF_SECRET` | **production** | Signs session tokens. 16+ chars; 32 random bytes is right. |
| `PORT` | no | Injected by most hosts. Defaults to 4000. |
| `DATABASE_URL` | **yes** | Postgres connection string. The app will not boot without it. |
| `SHELF_DATA_DIR` | no | Where covers fetched after deploy are written. |
| `SHELF_COVERS_DIR` | no | Point at a volume to keep covers fetched after deploy. |
| `SHELF_SESSION_IDLE_MINUTES` | no | Inactivity timeout, 1–1440. Defaults to 30. |
| `SHELF_DB_POOL` | no | Max pooled connections. Defaults to 10. |
| `SHELF_DB_SSL_INSECURE` | no | `1` skips database certificate verification. Only for a self-signed host. |
| `SHELF_WEB_DIST` | no | Direct path override. |

Copy [.env.example](.env.example) to `server/.env` for local development — the npm scripts
load it automatically. It is gitignored, so secrets stay out of the repository.

**If `SHELF_SECRET` is unset in production the app still boots**, but generates a random
secret per process and warns — so nobody can forge a token with a known default, at the cost
of logging everyone out on restart. Set it properly.

### Production hardening already in place

Helmet security headers with a CSP tuned for the app's own assets and Google Fonts, gzip
compression (the listings payload drops 19 kB → 4 kB), `trust proxy` for hosts that
terminate TLS upstream, immutable caching on hashed assets with `no-cache` on `index.html`,
SPA history fallback that does not swallow `/api` or `/covers` 404s, and a
`/api/health` endpoint wired to both the Docker healthcheck and the platform configs. Sessions
are HttpOnly, SameSite cookies rather than JavaScript-readable tokens; login, signup, payment,
rental-request and cover-lookup endpoints have in-process rate limits.

### Sessions

The session times out on **inactivity**, not on a fixed clock. The cookie is reissued while
someone is using the site, so nobody is signed out mid-task, and it lapses 30 minutes after
they stop. A `sat` claim records the original sign-in so the sliding cannot continue past an
absolute 7-day cap — a stolen cookie cannot be kept alive forever. Only `/api` requests slide
it, because a `Set-Cookie` on an immutable asset response would stop caches storing it.

When the session does lapse, the client notices in two places: any 401 from a non-auth
endpoint, and a re-check whenever a signed-in page is opened (some of them fetch nothing on
arrival, so waiting for a request would strand the person on a form that looks fine until
they press save). Either way they land on the login screen with an explanation and are
returned to the page they were on.

`SHELF_SESSION_IDLE_MINUTES` overrides the 30-minute window (1 to 1440).

Requires **Node 24+** — which is
why the image is pinned to `node:24-slim`.

## Stack

| | |
|---|---|
| Backend | Node + Express, Postgres via `pg` |
| Auth | Short-lived HttpOnly JWT cookie, passwords hashed with `scrypt` from `node:crypto` |
| Frontend | React 19 + Vite + React Router, Tailwind v4 |
| Distance | Haversine from the borrower's chosen origin, computed per request |

Five dependencies on the server (`express`, `cors`, `compression`, `helmet`, `jsonwebtoken`). The database is a single
file, `server/shelf.db`, created on first run and migrated forward on boot.

## Layout

```
server/src/
  index.js              Express app, route mounting, /covers static
  db.js                 schema, migrations, connection
  seed.js               10 lenders, 34 books, ~70 rentals, 54 reviews, full ledger
  covers.js             `npm run covers` — bulk cover fetch
  lib/geo.js            haversine, known areas, categories
  lib/auth.js           password hashing, cookie-session JWT, requireAuth
  lib/payments.js       the simulated card gateway
  lib/openlibrary.js    cover search + download
  routes/auth.js        signup, login, logout, me
  routes/listings.js    search, filtering, ranking, listing CRUD, cover lookup
  routes/rentals.js     request -> accept -> pay -> handover -> return, refunds, reviews

web/src/
  store/AppContext.jsx      session + the location everything is measured from
  lib/api.js                cookie-aware fetch wrapper
  components/BookCover.jsx  real jacket, or generated art as a fallback
  components/CheckoutSheet.jsx  card entry and the bill
  pages/                    Home, Browse, BookDetail, Auth, ListBook, Dashboard
```

## Design

Black, white and one grey ramp, in the style of Uber's app: tight headline tracking, 48px
controls, 12px radii, filled-grey inputs that invert to a black outline on focus, full-width
black primary buttons, bottom sheets on mobile that become centred dialogs on desktop. The
chrome stays strictly monochrome and the covers supply all the colour — the same split Uber
Eats uses between its UI and its photography.

## Notes and assumptions

- **Locations are Dhaka areas and prices are in taka (৳).** Both are one-line changes:
  `AREAS` in [server/src/lib/geo.js](server/src/lib/geo.js) and `CURRENCY` in
  [web/src/lib/format.js](web/src/lib/format.js).
- **Service fee** is 5% of the rental subtotal with a ৳5 floor — `quote()` in
  [server/src/routes/rentals.js](server/src/routes/rentals.js), mirrored client-side so the
  borrower sees the same number before submitting.
- **Deposits are held by the platform** in the ledger and released on return. Damage claims
  (withholding part of a deposit) are not modelled.
- The JWT secret defaults to a development value; set `SHELF_SECRET` before deploying.
