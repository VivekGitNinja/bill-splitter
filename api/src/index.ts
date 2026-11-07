import type { Balance, Bill, Member, Share } from '@bill-splitter/shared'
import { MAX_NAME_LENGTH, MAX_TOTAL_CENTS } from '@bill-splitter/shared'
import { type Context, Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

type AppContext = Context<{ Bindings: Env; Variables: { requestId: string } }>

type HomeRow = { id: string; name: string }
type MemberRow = { id: string; home_id: string; name: string; seq: number }
type BillRow = { id: string; home_id: string; title: string; total_cents: number }
type ShareRow = {
  id: string
  bill_id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  idempotency_key: string | null
}

// Validation bounds. Names and titles are trimmed before storing and capped
// so one huge value cannot bloat the database or the page.
const MAX_BODY_BYTES = 16_384
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Pagination defaults for list endpoints.
const PAGE_DEFAULT_LIMIT = 50
const PAGE_MAX_LIMIT = 100

// The web app's deployed origin. Update this when the Pages project name
// changes; localhost is for `pnpm dev`.
const ALLOWED_ORIGINS = ['http://localhost:5173', 'https://bill-splitter-web.pages.dev']

const app = new Hono<{ Bindings: Env; Variables: { requestId: string } }>()

// Every request gets an id for the logs and for error responses, so a
// failure in production can be traced back to one log line.
app.use('*', async (c, next) => {
  c.set('requestId', crypto.randomUUID())
  const started = Date.now()
  await next()
  console.log(
    `${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - started}ms requestId=${c.get('requestId')}`,
  )
})

app.use(secureHeaders())

app.use(
  '/api/*',
  cors({
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
    allowHeaders: ['Content-Type', 'Idempotency-Key'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 600,
  }),
)

// ---------------------------------------------------------------------------
// Abuse limits
// ---------------------------------------------------------------------------

type RateBucket = { windowStart: number; count: number }
// In-memory, per-Worker counters. Good enough for this assignment: a burst
// from one IP is slowed down, and the counters reset with each deploy.
const rateBuckets = new Map<string, RateBucket>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60

function clientIp(c: AppContext): string | null {
  const direct = c.req.header('CF-Connecting-IP')
  if (direct !== undefined && direct.trim() !== '') return direct.trim()
  const forwarded = c.req.header('X-Forwarded-For')
  if (forwarded !== undefined && forwarded.trim() !== '') {
    return forwarded.split(',')[0]?.trim() ?? null
  }
  return null
}

function isRateLimited(c: AppContext): boolean {
  const ip = clientIp(c)
  // No client IP is available (local dev, tests): there is nothing to key
  // the limit on, so the request is not limited.
  if (ip === null || ip === '') return false
  const now = Date.now()
  const bucket = rateBuckets.get(ip)
  if (bucket === undefined || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { windowStart: now, count: 1 })
    return false
  }
  bucket.count += 1
  return bucket.count > RATE_LIMIT_MAX
}

function rateLimitResponse(c: AppContext) {
  return c.json({ error: 'Too many requests, please try again later' }, 429, {
    'Retry-After': '60',
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ErrorStatus = 400 | 404 | 409 | 413 | 422 | 429 | 500

function errorResponse(c: AppContext, status: ErrorStatus, message: string) {
  return c.json({ error: message }, status)
}

function toMember(row: MemberRow): Member {
  return { id: row.id, homeId: row.home_id, name: row.name }
}

function toShare(row: ShareRow): Share {
  return {
    id: row.id,
    memberId: row.member_id,
    amountCents: row.amount_cents,
    paidAt: row.paid_at,
  }
}

type BodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; reason: 'malformed' | 'not-object' | 'too-large' }

async function readJsonBody(c: AppContext): Promise<BodyResult> {
  const contentLength = c.req.header('Content-Length')
  if (contentLength !== undefined) {
    const size = Number(contentLength)
    if (Number.isFinite(size) && size > MAX_BODY_BYTES) {
      return { ok: false, reason: 'too-large' }
    }
  }
  let text: string
  try {
    text = await c.req.text()
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return { ok: false, reason: 'too-large' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'not-object' }
  }
  return { ok: true, body: parsed as Record<string, unknown> }
}

function bodyErrorResponse(c: AppContext, reason: 'malformed' | 'not-object' | 'too-large') {
  if (reason === 'too-large') {
    return errorResponse(c, 413, 'request body is too large')
  }
  return errorResponse(c, 400, 'request body must be valid JSON')
}

// Returns the validation error for a name/title, or null when it is fine.
// Names are trimmed before storing; a blank or over-long value is rejected.
function textFieldError(value: unknown, field: 'name' | 'title'): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return `${field} is required`
  }
  if (value.trim().length > MAX_NAME_LENGTH) {
    return `${field} must be ${MAX_NAME_LENGTH} characters or fewer`
  }
  return null
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

async function findHome(db: D1Database, homeId: string): Promise<HomeRow | null> {
  // A non-UUID id can never exist: ids are always UUIDs generated by the API.
  if (!UUID_RE.test(homeId)) return null
  return db.prepare('SELECT id, name FROM homes WHERE id = ?').bind(homeId).first<HomeRow>()
}

function parsePagination(c: AppContext): { limit: number; offset: number } | { error: string } {
  let limit = PAGE_DEFAULT_LIMIT
  const limitRaw = c.req.query('limit')
  if (limitRaw !== undefined) {
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n < 1) {
      return { error: `limit must be a whole number between 1 and ${PAGE_MAX_LIMIT}` }
    }
    limit = Math.min(n, PAGE_MAX_LIMIT)
  }
  let offset = 0
  const cursorRaw = c.req.query('cursor')
  if (cursorRaw !== undefined) {
    const n = Number(cursorRaw)
    if (!Number.isInteger(n) || n < 0) {
      return { error: 'cursor must be a non-negative whole number' }
    }
    offset = n
  }
  return { limit, offset }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  if (isRateLimited(c)) return rateLimitResponse(c)
  const parsed = await readJsonBody(c)
  if (!parsed.ok) return bodyErrorResponse(c, parsed.reason)
  const nameProblem = textFieldError(parsed.body.name, 'name')
  if (nameProblem !== null) {
    return errorResponse(c, 400, nameProblem)
  }
  const name = (parsed.body.name as string).trim()
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
  return c.json({ id, name }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await findHome(c.env.DB, homeId)
  if (home === null) {
    return errorResponse(c, 404, 'home not found')
  }
  const parsed = await readJsonBody(c)
  if (!parsed.ok) return bodyErrorResponse(c, parsed.reason)
  const nameProblem = textFieldError(parsed.body.name, 'name')
  if (nameProblem !== null) {
    return errorResponse(c, 400, nameProblem)
  }
  const name = (parsed.body.name as string).trim()
  const existing = await c.env.DB.prepare('SELECT id FROM members WHERE home_id = ? AND name = ?')
    .bind(homeId, name)
    .first()
  if (existing !== null) {
    return errorResponse(c, 409, 'a member with this name already exists in this home')
  }
  const id = crypto.randomUUID()
  // The seq subquery runs inside this single statement, so the position a
  // member gets is the next free position in this home at insert time.
  // Two concurrent inserts can still compute the same seq, so a unique
  // violation is retried (up to 3 times) instead of surfacing as a 500.
  // A conflict always ends as a 409, never a 500.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await c.env.DB.prepare(
        'INSERT INTO members (id, home_id, name, seq) SELECT ?, ?, ?, COALESCE(MAX(seq), 0) + 1 FROM members WHERE home_id = ?',
      )
        .bind(id, homeId, name, homeId)
        .run()
      return c.json({ id, homeId, name }, 201)
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      // Either the seq collided with a concurrent insert, or the name was
      // taken between the check above and this insert. A taken name is a
      // conflict; a seq collision is worth one more try.
      const taken = await c.env.DB.prepare('SELECT id FROM members WHERE home_id = ? AND name = ?')
        .bind(homeId, name)
        .first()
      if (taken !== null) {
        return errorResponse(c, 409, 'a member with this name already exists in this home')
      }
    }
  }
  return errorResponse(c, 409, 'could not add the member, please try again')
})

app.get('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await findHome(c.env.DB, homeId)
  if (home === null) {
    return errorResponse(c, 404, 'home not found')
  }
  const page = parsePagination(c)
  if ('error' in page) {
    return errorResponse(c, 400, page.error)
  }
  // One extra row is fetched so the response can say whether another page
  // exists; `cursor` is the offset of the next page, as an opaque string.
  const result = await c.env.DB.prepare(
    'SELECT id, home_id, name, seq FROM members WHERE home_id = ? ORDER BY seq ASC LIMIT ? OFFSET ?',
  )
    .bind(homeId, page.limit + 1, page.offset)
    .all<MemberRow>()
  const rows = result.results
  const hasMore = rows.length > page.limit
  const members = rows.slice(0, page.limit).map(toMember)
  return c.json({ members, nextCursor: hasMore ? String(page.offset + page.limit) : null })
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await findHome(c.env.DB, homeId)
  if (home === null) {
    return errorResponse(c, 404, 'home not found')
  }
  const parsed = await readJsonBody(c)
  if (!parsed.ok) return bodyErrorResponse(c, parsed.reason)
  const titleProblem = textFieldError(parsed.body.title, 'title')
  if (titleProblem !== null) {
    return errorResponse(c, 400, titleProblem)
  }
  const totalCents = parsed.body.totalCents
  if (
    typeof totalCents !== 'number' ||
    !Number.isSafeInteger(totalCents) ||
    totalCents <= 0 ||
    totalCents > MAX_TOTAL_CENTS
  ) {
    return errorResponse(
      c,
      422,
      `totalCents must be a positive whole number no larger than ${MAX_TOTAL_CENTS}`,
    )
  }
  const membersResult = await c.env.DB.prepare(
    'SELECT id, home_id, name, seq FROM members WHERE home_id = ? ORDER BY seq ASC',
  )
    .bind(homeId)
    .all<MemberRow>()
  const members = membersResult.results
  if (members.length === 0) {
    return errorResponse(c, 422, 'home has no members')
  }
  // Split rule: every member gets floor(total / n); the remainder cents go
  // one by one to the first members, in the order they were added, so the
  // shares always add up to exactly totalCents.
  const base = Math.floor(totalCents / members.length)
  const remainder = totalCents - base * members.length
  const billId = crypto.randomUUID()
  const title = (parsed.body.title as string).trim()
  const shares: Share[] = []
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents),
  ]
  members.forEach((member, index) => {
    const amountCents = base + (index < remainder ? 1 : 0)
    const shareId = crypto.randomUUID()
    shares.push({ id: shareId, memberId: member.id, amountCents, paidAt: null })
    statements.push(
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at, idempotency_key) VALUES (?, ?, ?, ?, NULL, NULL)',
      ).bind(shareId, billId, member.id, amountCents),
    )
  })
  // One batch: the bill and all of its shares are written together, so a
  // bill can never exist with only some of its shares.
  await c.env.DB.batch(statements)
  const bill: Bill = { id: billId, homeId, title, totalCents, shares }
  return c.json(bill, 201)
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await findHome(c.env.DB, homeId)
  if (home === null) {
    return errorResponse(c, 404, 'home not found')
  }
  const page = parsePagination(c)
  if ('error' in page) {
    return errorResponse(c, 400, page.error)
  }
  const billsResult = await c.env.DB.prepare(
    'SELECT id, home_id, title, total_cents FROM bills WHERE home_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ? OFFSET ?',
  )
    .bind(homeId, page.limit + 1, page.offset)
    .all<BillRow>()
  const billRows = billsResult.results
  const hasMore = billRows.length > page.limit
  const pageBills = billRows.slice(0, page.limit)
  const sharesByBill = new Map<string, Share[]>()
  if (pageBills.length > 0) {
    const placeholders = pageBills.map(() => '?').join(', ')
    const sharesResult = await c.env.DB.prepare(
      `SELECT s.id, s.bill_id, s.member_id, s.amount_cents, s.paid_at, s.idempotency_key FROM shares s JOIN bills b ON b.id = s.bill_id JOIN members m ON m.id = s.member_id WHERE s.bill_id IN (${placeholders}) ORDER BY b.created_at ASC, b.rowid ASC, m.seq ASC`,
    )
      .bind(...pageBills.map((bill) => bill.id))
      .all<ShareRow>()
    for (const row of sharesResult.results) {
      const list = sharesByBill.get(row.bill_id) ?? []
      list.push(toShare(row))
      sharesByBill.set(row.bill_id, list)
    }
  }
  const bills: Bill[] = pageBills.map((row) => ({
    id: row.id,
    homeId: row.home_id,
    title: row.title,
    totalCents: row.total_cents,
    shares: sharesByBill.get(row.id) ?? [],
  }))
  return c.json({ bills, nextCursor: hasMore ? String(page.offset + page.limit) : null })
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  if (isRateLimited(c)) return rateLimitResponse(c)
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  if (!UUID_RE.test(billId) || !UUID_RE.test(shareId)) {
    return errorResponse(c, 404, 'bill or share not found')
  }
  const key = c.req.header('Idempotency-Key')
  if (key === undefined || key.trim() === '') {
    return errorResponse(c, 400, 'Idempotency-Key header is required')
  }
  const share = await c.env.DB.prepare(
    'SELECT s.id, s.bill_id, s.member_id, s.amount_cents, s.paid_at, s.idempotency_key FROM shares s JOIN bills b ON b.id = s.bill_id WHERE s.id = ? AND s.bill_id = ?',
  )
    .bind(shareId, billId)
    .first<ShareRow>()
  if (share === null) {
    return errorResponse(c, 404, 'bill or share not found')
  }
  // Atomic pay: this UPDATE only matches a share that is still unpaid, so
  // when two requests race for the same share, exactly one of them changes
  // a row. Nothing here reads the share, decides, and then writes.
  const paidAt = new Date().toISOString()
  const update = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND paid_at IS NULL',
  )
    .bind(paidAt, key, shareId)
    .run()
  if (update.meta.changes === 1) {
    return c.json({
      id: share.id,
      memberId: share.member_id,
      amountCents: share.amount_cents,
      paidAt,
    })
  }
  // The share was already paid. A retry with the same key gets the original
  // result back; a different key is a second payment attempt and conflicts.
  const paid = await c.env.DB.prepare(
    'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ?',
  )
    .bind(shareId)
    .first<ShareRow>()
  if (paid !== null && paid.idempotency_key === key) {
    return c.json(toShare(paid))
  }
  return errorResponse(c, 409, 'share already paid')
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await findHome(c.env.DB, homeId)
  if (home === null) {
    return errorResponse(c, 404, 'home not found')
  }
  const result = await c.env.DB.prepare(
    'SELECT m.id AS memberId, m.name AS name, COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents ELSE 0 END), 0) AS outstandingCents FROM members m LEFT JOIN bills b ON b.home_id = m.home_id LEFT JOIN shares s ON s.bill_id = b.id AND s.member_id = m.id WHERE m.home_id = ? GROUP BY m.id, m.name ORDER BY m.seq ASC',
  )
    .bind(homeId)
    .all<Balance>()
  return c.json({ balances: result.results })
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  // The error id is returned so a failure can be matched to its log line.
  const errorId = c.get('requestId') ?? crypto.randomUUID()
  console.error(`error requestId=${errorId}`, err)
  return c.json({ error: 'Internal server error', errorId }, 500)
})

export default app
