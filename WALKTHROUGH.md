# Walkthrough: Shared Bill Splitter

Plain-language notes for learning this codebase before explaining it live.
Nothing here is submitted anywhere; the project lives only in this folder
until someone deploys it (see "Deploying it live" at the end).

## Architecture

A pnpm workspace with two packages:

- `api/` — a Hono app running on Cloudflare Workers. All of the logic lives
  here, in one file: `api/src/index.ts`. The database is Cloudflare D1
  (SQLite), reached through the `DB` binding declared in
  `api/wrangler.jsonc`. The schema lives in `api/migrations/0001_init.sql`
  and is applied to a fresh database before the tests run and before local
  dev starts.
- `web/` — a React + Vite + TanStack Router single-page app. The whole page
  is `web/src/routes/index.tsx`, and every API call goes through the typed
  client in `web/src/api.ts`. The page talks to the API over `/api` paths:
  in development Vite proxies those to the local Worker on port 8787, and
  in a deployed build the base URL comes from the `VITE_API_URL`
  environment variable (see "Deploying it live").

There is no other backend, no auth, and no extra service. A home is just a
row, a member belongs to a home, a bill belongs to a home, and a share
belongs to one bill and one member.

## Data flow end to end

1. **Create a home.** `POST /api/homes { name }` inserts a row in `homes`
   and returns `201 { id, name }`. The id is a random UUID.
2. **Add members.** `POST /api/homes/:homeId/members { name }` first checks
   the home exists (otherwise 404), then inserts a row in `members`. Each
   member gets a `seq` number: 1 for the first member added, 2 for the
   second, and so on. That order matters twice: it decides who gets the
   leftover cents in a split, and it decides the order of the balances
   list. The `seq` is computed inside the `INSERT` statement itself
   (`COALESCE(MAX(seq), 0) + 1` for that home), not by reading and then
   writing.
3. **Create a bill.** `POST /api/homes/:homeId/bills { title, totalCents }`
   checks the home exists (404), checks the amount is a positive whole
   number (422 otherwise), and checks the home has at least one member
   (422 otherwise). It then computes one share per member (see "The split
   rule"), and inserts the bill row plus all of its share rows in a single
   D1 `batch`, so a bill can never exist with only some of its shares.
   It returns `201` with the bill and its shares, every share starting
   with `paidAt: null`.
4. **Pay a share.** `POST /api/bills/:billId/shares/:shareId/pay` with an
   `Idempotency-Key` header. See "Idempotency and concurrency" below.
   It returns `200 { id, memberId, amountCents, paidAt }`.
5. **Balances.** `GET /api/homes/:homeId/balances` sums each member's
   unpaid shares across all bills of the home and returns them in
   member-add order. Paid shares contribute zero.

The web page mirrors this flow: enter or create a home id, load its
members, bills, and balances, add members, create bills, and pay shares
from the bill list. Two extra read endpoints exist only so the page can
work: `GET /api/homes/:homeId/members` and `GET /api/homes/:homeId/bills`
(both 404 when the home does not exist). They return the same shapes as
the write endpoints, so nothing new has to be learned to use them.

Every error response from the API is JSON of the shape
`{ "error": "message" }`, including 404 for unknown routes and 500 for
unexpected failures.

## Each constraint, and what it stops

The schema has eight named constraints. They are a safety net under the
code: the API checks things first, and the database refuses anything
that slips through.

- `fk_members_home` — a member's `home_id` must point at a real home.
  Stops orphan members that belong to a home that does not exist.
- `uq_members_home_seq` — `(home_id, seq)` is unique. Stops two members
  of the same home getting the same position, which would make the split
  order and the balances order ambiguous.
- `fk_bills_home` — a bill's `home_id` must point at a real home. Stops
  orphan bills.
- `chk_bills_total_positive` — `total_cents > 0`. Stops zero or negative
  bills even if a caller bypasses the API's own 422 check.
- `fk_shares_bill` — a share's `bill_id` must point at a real bill.
  Stops orphan shares.
- `fk_shares_member` — a share's `member_id` must point at a real
  member. Stops shares owed by someone who is not a member.
- `chk_shares_amount_nonnegative` — `amount_cents >= 0`. Stops negative
  shares, which would make balances and totals lie.
- `uq_shares_bill_member` — `(bill_id, member_id)` is unique. Stops a
  member getting two shares of the same bill, which would double-count
  what they owe.

## How idempotency and concurrency safety work

Paying is the only operation where "the same request twice" and "two
requests at once" can corrupt data, so it gets the careful treatment:

1. The client sends an `Idempotency-Key` header. Missing key means
   `400`. The key is just a string the caller invents; the web page
   generates a fresh UUID for each Pay click.
2. The API looks the share up by both ids (`shareId` and `billId`
   together). If either does not exist, or the share belongs to a
   different bill, it answers `404`.
3. It then runs a single conditional update:
   `UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND paid_at IS NULL`.
   This is the whole trick. The database itself decides whether the row
   is still unpaid, in the same step that marks it paid. Two requests
   racing for the same share cannot both match: the first one changes
   the row, the second one finds `paid_at` already set and changes
   nothing. There is no moment where the code reads "unpaid", pauses,
   and then writes "paid" while another request does the same.
4. If the update changed one row, that request won and gets `200` with
   the new `paidAt`.
5. If it changed zero rows, the share was already paid. The API reads
   the share back: if the stored key equals the key on this request, it
   is a retry of the same payment, so it returns `200` with the
   original `paidAt` (the same result, no second payment). If the key
   differs, it is a genuinely different payment attempt for an
   already-paid share, so it answers `409`.

Because the key is stored on the share row, a retry always finds it, and
because the update is conditional, concurrency is decided by the
database, not by application code racing.

## How the split rule works

All money is integer cents. For a bill of `totalCents` split over `n`
members, in member-add order:

- `base = floor(totalCents / n)` — what everyone gets for sure.
- `remainder = totalCents - base * n` — the cents left over, always
  between 0 and `n - 1`.
- The first `remainder` members get `base + 1`; everyone else gets
  `base`.

Example from the spec: 1000 cents over 3 members gives
`base = 333`, `remainder = 1`, so the shares are `334, 333, 333`, which
add up to exactly 1000. A 7-member split of 100001 cents works the same
way and also adds up exactly, because `base * n + remainder` is always
the original total by construction.

## The web page and failure cases

The page (`web/src/routes/index.tsx`) is built so that API trouble never
crashes it:

- **Loading:** while members, bills, and balances are being fetched it
  shows "Loading…".
- **Empty:** a home with no members says "No members yet", and a home
  with no bills says "No bills yet", instead of rendering nothing.
- **Error:** every fetch is wrapped so a failed request shows a readable
  error banner and keeps whatever data was already on screen. A
  15-second timeout turns a hung API into an error message instead of a
  frozen page.
- **Failed payment:** the Pay button is disabled while that share is
  paying, and the list is only refreshed after a successful payment. If
  payment fails, the error is shown next to that share and the share
  stays visibly unpaid. The page never marks a share paid optimistically.
- **Bad input:** creating a bill with a zero, negative, or fractional
  amount is rejected in the form, and the API's own 422 is shown if a
  bad value gets through anyway (for example, a home with no members).

## One trade-off made

**The split is frozen when the bill is created.** Adding a member later
does not rebalance bills that already exist; the new member simply joins
future bills. The alternative — recomputing every bill whenever members
change — would rewrite history: a share someone already paid could
change amount, and a settled bill could come back to life. Freezing the
split keeps each bill auditable (what you saw when you paid is what the
bill always was), at the cost that a home that gains a member mid-month
has old bills split among the old members only. For a small shared-home
tool, stable bills beat perfectly balanced ones.

A related small trade-off: the idempotency key lives on the share row
instead of in a separate table, which keeps the schema to four tables.
That means a key is scoped to one share — reusing the same key on a
different share is treated as an independent payment, not a duplicate.
The spec only requires same-share retries to be safe, so that scope is
exactly right.

## Deploying it live

Nothing below has been run: it needs Cloudflare credentials, which this
build does not have. The steps are exact, in order, and the commands
assume you are in the repo root unless noted.

### What you need first

- A Cloudflare account with Workers and D1 enabled.
- Either an interactive login (`wrangler login`, which opens a browser
  for OAuth) or an API token with permission to manage Workers, D1, and
  Pages, plus the account id. As environment variables:
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- No other secrets. The app has no auth and no third-party keys.

### 1. Create the D1 database

```bash
wrangler d1 create bill-splitter
```

Copy the `database_id` from the output into `api/wrangler.jsonc`,
replacing the placeholder `"local-only"`. That placeholder only works
for local development; a remote deploy with it will fail. Nothing else
in `wrangler.jsonc` needs to change: the binding is already `DB`, the
migrations directory is already `migrations`, and the worker name is
already `bill-splitter-api`.

### 2. Apply the migrations to the remote database

From `api/`:

```bash
wrangler d1 migrations apply DB --remote
```

This creates the `homes`, `members`, `bills`, and `shares` tables,
with all eight named constraints, in the remote database. (Local
development uses the same command without `--remote`, which
`pnpm --filter bill-splitter-api dev` already runs for you.)

### 3. Deploy the Worker

From `api/`:

```bash
wrangler deploy
```

Note the Worker URL it prints, for example
`https://bill-splitter-api.<your-subdomain>.workers.dev`. That URL is
the API base for the web app.

### 4. Build and deploy the web app

From the repo root, with the Worker URL from step 3:

```bash
VITE_API_URL=https://bill-splitter-api.<your-subdomain>.workers.dev pnpm --filter bill-splitter-web build
```

This produces `web/dist/`. The built app contains no hardcoded host:
every request goes to `VITE_API_URL`, so pointing the same build at a
different Worker is just a rebuild with a different value. Deploy
`web/dist/` to any static host. With Cloudflare Pages:

```bash
wrangler pages deploy web/dist
```

(Netlify, Vercel, or any static host works the same way: publish the
`web/dist/` directory.)

### 5. Smoke-check the live deployment

```bash
curl https://bill-splitter-api.<your-subdomain>.workers.dev/api/health
# expect: {"status":"ok"}
```

Then open the deployed web URL, create a home, add members, create a
bill, and pay a share. If the page shows an API error instead, the
usual cause is `VITE_API_URL` pointing at the wrong Worker URL or the
remote migrations not having been applied in step 2.

### Local commands, for reference

```bash
pnpm install        # install once at the root
pnpm dev            # api on :8787 and web on :5173, local D1
pnpm check          # Biome format + lint, must pass
pnpm typecheck      # tsc on both packages, must pass
pnpm test           # visible tests in api/test, must pass
pnpm build          # production build of the web app
```
