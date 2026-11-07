# SDE Intern Assignment: Shared Bill Splitter

Welcome. In this assignment you build a small bill splitter for a shared home. It has two parts:

1. **Homes and members:** create a home and add members to it.
2. **Bill splitting:** split a bill between the members. Each member pays their own share.

The assignment is small on purpose. We want correct, safe, and clear code. We do not want many features.

## What we look at

- **Your code passes the tests.** The tests decide, not opinion. You get the visible tests. We also run extra tests that you do not see.
- **Your code is safe when things go wrong.** Wrong input, repeated requests, and two requests at the same time must not break your data.
- **Your code is typed.** Use TypeScript. Do not use `any`.
- **You understand your code.** You record a short video and explain it.

Take your time. A careful, correct solution is better than a fast one. We expect 2 to 3 days of real work.

## Stack (required)

- **API:** Hono on Cloudflare Workers
- **Database:** Cloudflare D1 (SQLite). The binding is `DB` in `api/wrangler.jsonc`.
- **Web:** React, Vite, TanStack Router
- **Language:** TypeScript on both sides
- **Tests:** Vitest, running inside the Workers runtime
- **Quality:** Biome. `pnpm check` and `pnpm typecheck` must pass.

You choose the rest (styling, form library, validation library). Pick tools you can explain.

## The task

The assignment has two parts. Do Part 1 first. Part 2 builds on it.

**Database.** Write the schema as SQL migration files in `api/migrations/`. For example `0001_init.sql`. The tests apply every file in this folder. Your schema must have **at least 3 named constraints** that protect the data. For example a foreign key, a `CHECK`, or a `UNIQUE` key. Be ready to explain what each constraint stops.

**Errors.** Every error response is JSON: `{ "error": "message" }`.

## Part 1: Homes and members

Create a home and add members to it. The order in which members are added matters in Part 2.

#### `POST /api/homes`

- Request: `{ "name": string }`
- Success: `201` `{ id, name }`

#### `POST /api/homes/:homeId/members`

- Request: `{ "name": string }`
- Success: `201` `{ id, homeId, name }`
- Errors: `404` home not found

Visible tests: `api/test/homes.test.ts`.

## Part 2: Bill splitting

Add a bill to a home, split it between the members, and let each member pay their share.

All amounts are whole **cents** (integers). `100` cents is 1 dollar. Never use decimals for money.

#### `POST /api/homes/:homeId/bills`

- Request: `{ "title": string, "totalCents": number }`
- Success: `201` `{ id, homeId, title, totalCents, shares: [{ id, memberId, amountCents, paidAt: null }] }`
- Errors: `404` home not found. `422` total is not a positive whole number, or the home has no members.

#### `POST /api/bills/:billId/shares/:shareId/pay`

- Request: header `Idempotency-Key`
- Success: `200` `{ id, memberId, amountCents, paidAt }`
- Errors: `400` key missing. `404` bill or share not found. `409` share already paid with a different key.

#### `GET /api/homes/:homeId/balances`

- Success: `200` `{ balances: [{ memberId, name, outstandingCents }] }`
- Errors: `404` home not found

**Rules**

- **Split.** A bill is split between all members of the home. The shares always add up to `totalCents`. If the amount does not divide evenly, the extra cents go to the members one by one, in the order the members were added to the home. Example: 1000 cents between 3 members gives `334`, `333`, `333`.
- **Pay.** Paying marks one share as paid and sets `paidAt`. If the same `Idempotency-Key` is sent again for the same share, answer `200` with the same result. Do not pay twice. If two requests pay the same share at the same time, only one may succeed.
- **Balances.** `outstandingCents` is the sum of the member's unpaid shares, across all bills of the home. List the members in the order they were added.

Visible tests: `api/test/bills.test.ts` and `api/test/payments.test.ts`.

#### Web page

Build one page that:

- shows the bills of a home and the shares of each bill,
- lets a member pay a share,
- shows clear **loading**, **empty**, and **error** states,
- keeps the share unpaid and shows an error if the payment fails.

The page must not crash when the API answers with an error or is slow.

## Cases you must handle

You must handle these cases and talk about them in your video:

1. A home with no members.
2. An amount that is zero, negative, or not a whole number.
3. An amount that does not divide evenly.
4. The same payment request sent twice.
5. Two members paying the same share at the same time.
6. A bill or share that does not exist.
7. The API answers with a 500 error or is slow. The web page must not crash.

## Run it

This is a pnpm workspace. Install once at the root.

```bash
pnpm install
pnpm dev          # api on :8787 and web on :5173
```

Open http://localhost:5173. The starter page shows a title. `/api/health` returns `{ "status": "ok" }`.

```bash
pnpm test         # run the visible tests in api/test
pnpm check        # Biome: format and lint. Must pass.
pnpm check:fix    # fix what Biome can fix
pnpm typecheck    # tsc on both packages. Must pass.
pnpm build        # production build of the web app
```

`pnpm dev` applies your migrations to a local database before it starts the API.

If pnpm says some build scripts were ignored, run `pnpm approve-builds` and allow `esbuild` and `workerd`.

When you change `api/wrangler.jsonc`, refresh the `Env` types:

```bash
pnpm --filter bill-splitter-api cf-typegen
```

## Rules for the tests

- The visible tests are in `api/test`. They start with a failing result. Your job is to make them pass.
- Do **not** change the visible tests or `api/test/helpers.ts`. We compare them with the original.
- We run extra tests after you submit. They test the cases in "Cases you must handle" more closely.

## AI policy

You can use AI tools. Tell us which ones and where in your answers on the form.
You must understand every line you submit. We check this with your video and in a live call. "The AI wrote it" is not an answer.

## How to submit

1. Click **Use this template**, then **Create a new repository**. Make the repository **public**.
2. Build your solution in your new repository. Small, clear commits are welcome.
3. Update this README with a short section called **Decisions**. Write 3 decisions you made and why.
4. Record a video of **3 minutes or less** (Loom or unlisted YouTube). Show the architecture, the data flow, and one trade-off you made. Make sure anyone with the link can view it.
5. Paste the repository link and the video link in the application form.

We will run `pnpm install && pnpm check && pnpm typecheck && pnpm test` on your repository.

## Decisions

1. **Pay with one atomic conditional UPDATE, and keep the idempotency key on the share.** Paying runs `UPDATE shares SET paid_at, idempotency_key WHERE id = ? AND paid_at IS NULL`, so when two requests race for the same share exactly one of them changes a row. A retry with the same key then reads the stored key and returns the original result (200), while a different key gets 409. No separate payments table is needed, and there is no read-then-write window to double-pay through.
2. **Split the bill once, at creation time, with leftover cents going to the earliest members.** Each share is `floor(total / n)` cents, and the first `total mod n` members (in the order they were added) get one extra cent, so the shares always add up to exactly `totalCents`. Computing the split once keeps reads simple and freezes each bill: adding a member later does not rewrite bills that already exist.
3. **Money is integer cents everywhere; formatting happens only on screen.** The API, the database, and the split math never see a decimal, so rounding can never lose or invent a cent. The web page only converts cents to dollars for display (`$3.34`), never for storage or calculation.

## Project notes

Added while hardening the solution for real use. Nothing here changes the
assignment's split or pay rules.

### Architecture

- `api/` — Hono on Cloudflare Workers, D1 (SQLite) via the `DB` binding.
- `web/` — React + Vite + TanStack Router. The home id is kept in the URL
  (`?home=<id>`) and in `localStorage`, so a reload or a shared link reopens
  the same home.
- `shared/` — the `Member`, `Share`, `Bill`, and `Balance` types, plus the
  validation bounds (`MAX_NAME_LENGTH`, `MAX_TOTAL_CENTS`). Both sides
  import them from `@bill-splitter/shared`, so the wire shapes cannot drift.

### No auth, by design — home ids are bearer tokens

There is deliberately no login. A home id is a random UUID, and anyone who
knows it can see and change that home. Treat a home id like a password:
do not post it publicly. This matches the assignment (no auth requirement),
and no fake auth was added to pretend otherwise. A real multi-user version
would need accounts and per-home membership checks.

### Limits

- Request bodies are capped at 16 KB (413 above that).
- `POST /api/homes` and pay are rate-limited to 60 requests per minute per
  client IP (429 above that), keyed on `CF-Connecting-IP`. Requests without
  a client IP (local dev, tests) are not limited.
- Names and titles are trimmed and capped at 200 characters; `totalCents`
  must be a safe integer between 1 and 100,000,000.
- Duplicate member names in one home are rejected with 409.

### Pagination

`GET /api/homes/:homeId/members` and `GET /api/homes/:homeId/bills` accept
`?limit=` (default 50, max 100) and `?cursor=` (the `nextCursor` from the
previous page, `null` when there is no next page).

### Errors and logging

Every error is JSON `{ "error": "message" }`. A 500 also carries an
`errorId` that matches one log line, and every request is logged with its
method, path, status, duration, and request id.

### Environment and deploy

- `VITE_API_URL` — the deployed Worker URL for the web build (see
  `.env.example`). Empty means the Vite dev proxy.
- `pnpm migrate:remote` — apply D1 migrations to the remote database.
- `pnpm deploy:api` — deploy the Worker (`wrangler deploy`).
- `pnpm deploy:web` — build the web app and deploy it to Cloudflare Pages.
- Deploy needs a Cloudflare account and the `CLOUDFLARE_API_TOKEN` /
  `CLOUDFLARE_ACCOUNT_ID` secrets. `api/wrangler.jsonc` has `staging` and
  `production` env blocks; the `database_id` values are still the
  `local-only` placeholder — replace them with the real ids from
  `wrangler d1 create` before the first remote deploy.
- CI (`.github/workflows/ci.yml`) runs install, `pnpm check`, `pnpm
  typecheck`, `pnpm test`, and `pnpm build` on push and pull requests.
  `.github/workflows/deploy.yml` deploys on push to `main`.
- Node 24 and pnpm 10 are pinned (`.nvmrc`, `packageManager` in
  `package.json`). Dependabot checks npm and GitHub Actions weekly.
