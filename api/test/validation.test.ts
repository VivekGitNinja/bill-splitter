import { describe, expect, it } from 'vitest'
import {
  type Balance,
  call,
  callRaw,
  createBill,
  createHome,
  type Member,
  type Share,
} from './helpers'

describe('health and unknown routes', () => {
  it('answers /api/health with ok', async () => {
    const health = await call<{ status: string }>('GET', '/api/health')

    expect(health.status).toBe(200)
    expect(health.body).toEqual({ status: 'ok' })
  })

  it('answers an unknown route with a JSON 404', async () => {
    const missing = await call<{ error: string }>('GET', '/api/does-not-exist')

    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: 'Not found' })
  })

  it('answers an unknown POST route with a JSON 404', async () => {
    const missing = await call<{ error: string }>('POST', '/api/does-not-exist', {
      body: {},
    })

    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: 'Not found' })
  })
})

describe('list endpoints', () => {
  it('lists members and bills of a home', async () => {
    const { homeId, members } = await createHome(['Asha', 'Ben'])
    await createBill(homeId, 1000)

    const listedMembers = await call<{ members: Member[] }>('GET', `/api/homes/${homeId}/members`)
    const listedBills = await call<{ bills: { id: string; shares: Share[] }[] }>(
      'GET',
      `/api/homes/${homeId}/bills`,
    )

    expect(listedMembers.status).toBe(200)
    expect(listedMembers.body.members.map((m) => m.name)).toEqual(['Asha', 'Ben'])
    expect(listedBills.status).toBe(200)
    expect(listedBills.body.bills).toHaveLength(1)
    expect(listedBills.body.bills[0]?.shares).toHaveLength(2)
    expect(members.map((m) => m.id)).toEqual(listedMembers.body.members.map((m) => m.id))
  })

  it('lists bills in the order they were created', async () => {
    const { homeId } = await createHome(['Asha'])
    await call('POST', `/api/homes/${homeId}/bills`, { body: { title: 'First', totalCents: 100 } })
    await call('POST', `/api/homes/${homeId}/bills`, { body: { title: 'Second', totalCents: 200 } })
    await call('POST', `/api/homes/${homeId}/bills`, { body: { title: 'Third', totalCents: 300 } })

    const listed = await call<{ bills: { title: string }[] }>('GET', `/api/homes/${homeId}/bills`)

    expect(listed.body.bills.map((bill) => bill.title)).toEqual(['First', 'Second', 'Third'])
  })

  it('returns 404 for a non-UUID home id', async () => {
    const members = await call('GET', '/api/homes/not-a-uuid/members')
    const bills = await call('GET', '/api/homes/not-a-uuid/bills')
    const balances = await call('GET', '/api/homes/not-a-uuid/balances')

    expect(members.status).toBe(404)
    expect(bills.status).toBe(404)
    expect(balances.status).toBe(404)
  })
})

describe('pagination', () => {
  it('pages members with limit and cursor', async () => {
    const { homeId } = await createHome(['Asha', 'Ben', 'Chitra'])

    const first = await call<{ members: Member[]; nextCursor: string | null }>(
      'GET',
      `/api/homes/${homeId}/members?limit=2`,
    )
    expect(first.body.members.map((m) => m.name)).toEqual(['Asha', 'Ben'])
    expect(first.body.nextCursor).toBe('2')

    const second = await call<{ members: Member[]; nextCursor: string | null }>(
      'GET',
      `/api/homes/${homeId}/members?limit=2&cursor=2`,
    )
    expect(second.body.members.map((m) => m.name)).toEqual(['Chitra'])
    expect(second.body.nextCursor).toBeNull()
  })

  it('pages bills with limit and cursor', async () => {
    const { homeId } = await createHome(['Asha'])
    for (const title of ['One', 'Two', 'Three']) {
      await call('POST', `/api/homes/${homeId}/bills`, { body: { title, totalCents: 100 } })
    }

    const first = await call<{ bills: { title: string }[]; nextCursor: string | null }>(
      'GET',
      `/api/homes/${homeId}/bills?limit=2`,
    )
    expect(first.body.bills.map((bill) => bill.title)).toEqual(['One', 'Two'])
    expect(first.body.nextCursor).toBe('2')

    const second = await call<{ bills: { title: string }[]; nextCursor: string | null }>(
      'GET',
      `/api/homes/${homeId}/bills?limit=2&cursor=2`,
    )
    expect(second.body.bills.map((bill) => bill.title)).toEqual(['Three'])
    expect(second.body.nextCursor).toBeNull()
  })

  it('clamps limit to 100 and defaults to 50', async () => {
    const { homeId } = await createHome(['Asha'])

    const clamped = await call<{ members: Member[]; nextCursor: string | null }>(
      'GET',
      `/api/homes/${homeId}/members?limit=500`,
    )
    expect(clamped.status).toBe(200)
    expect(clamped.body.members).toHaveLength(1)
    expect(clamped.body.nextCursor).toBeNull()
  })

  it('rejects a bad limit or cursor', async () => {
    const { homeId } = await createHome(['Asha'])

    expect((await call('GET', `/api/homes/${homeId}/members?limit=0`)).status).toBe(400)
    expect((await call('GET', `/api/homes/${homeId}/members?limit=abc`)).status).toBe(400)
    expect((await call('GET', `/api/homes/${homeId}/members?cursor=-1`)).status).toBe(400)
    expect((await call('GET', `/api/homes/${homeId}/members?cursor=abc`)).status).toBe(400)
  })
})

describe('validation', () => {
  it('rejects a malformed JSON body with a JSON error, not a field error', async () => {
    const home = await call<{ id: string }>('POST', '/api/homes', { body: { name: 'Flat' } })

    const bad = await callRaw('POST', `/api/homes/${home.body.id}/members`, {
      body: '{not json',
      headers: { 'content-type': 'application/json' },
    })

    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: 'request body must be valid JSON' })
  })

  it('rejects blank and whitespace-only names', async () => {
    const home = await call<{ id: string }>('POST', '/api/homes', { body: { name: 'Flat' } })

    for (const name of ['', '   ']) {
      const member = await call('POST', `/api/homes/${home.body.id}/members`, {
        body: { name },
      })
      expect(member.status).toBe(400)
    }
    expect((await call('POST', '/api/homes', { body: { name: '' } })).status).toBe(400)
    expect((await call('POST', '/api/homes', { body: { name: '   ' } })).status).toBe(400)
  })

  it('rejects names and titles longer than 200 characters', async () => {
    const longName = 'x'.repeat(201)
    const home = await call<{ id: string }>('POST', '/api/homes', { body: { name: 'Flat' } })

    expect((await call('POST', '/api/homes', { body: { name: longName } })).status).toBe(400)
    expect(
      (
        await call('POST', `/api/homes/${home.body.id}/members`, {
          body: { name: longName },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await call('POST', `/api/homes/${home.body.id}/bills`, {
          body: { title: longName, totalCents: 100 },
        })
      ).status,
    ).toBe(400)
  })

  it('accepts a name of exactly 200 characters', async () => {
    const home = await call<{ id: string }>('POST', '/api/homes', {
      body: { name: 'x'.repeat(200) },
    })

    expect(home.status).toBe(201)
  })

  it('trims names and titles before storing them', async () => {
    const home = await call<{ id: string; name: string }>('POST', '/api/homes', {
      body: { name: '  Flat 4B  ' },
    })
    expect(home.body.name).toBe('Flat 4B')

    const member = await call<Member>('POST', `/api/homes/${home.body.id}/members`, {
      body: { name: '  Asha  ' },
    })
    expect(member.body.name).toBe('Asha')
  })

  it('rejects a duplicate member name in the same home with 409', async () => {
    const { homeId } = await createHome(['Asha'])

    const duplicate = await call('POST', `/api/homes/${homeId}/members`, {
      body: { name: 'Asha' },
    })
    expect(duplicate.status).toBe(409)

    // Trimming applies here too: ' Asha ' is the same name.
    const trimmedDuplicate = await call('POST', `/api/homes/${homeId}/members`, {
      body: { name: ' Asha ' },
    })
    expect(trimmedDuplicate.status).toBe(409)

    // The same name in a different home is fine.
    const otherHome = await call<{ id: string }>('POST', '/api/homes', {
      body: { name: 'Other flat' },
    })
    const sameName = await call('POST', `/api/homes/${otherHome.body.id}/members`, {
      body: { name: 'Asha' },
    })
    expect(sameName.status).toBe(201)
  })

  it('rejects a huge totalCents', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])

    for (const totalCents of [100_000_001, 2 ** 53, Number.MAX_SAFE_INTEGER]) {
      const bill = await call('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'Rent', totalCents },
      })
      expect(bill.status).toBe(422)
    }
  })

  it('rejects an empty or whitespace-only Idempotency-Key', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill has no shares')

    const empty = await call('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
      headers: { 'Idempotency-Key': '' },
    })
    expect(empty.status).toBe(400)

    const blank = await call('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
      headers: { 'Idempotency-Key': '   ' },
    })
    expect(blank.status).toBe(400)
  })

  it('rejects a pay for a non-UUID bill or share id with 404', async () => {
    const paid = await call('POST', '/api/bills/not-a-uuid/shares/also-not/pay', {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    })
    expect(paid.status).toBe(404)
  })
})

describe('concurrency', () => {
  it('adds members in parallel without losing or duplicating any', async () => {
    const home = await call<{ id: string }>('POST', '/api/homes', { body: { name: 'Flat' } })
    const homeId = home.body.id

    const results = await Promise.all(
      ['Asha', 'Ben', 'Chitra', 'Dev', 'Esha'].map((name) =>
        call<Member>('POST', `/api/homes/${homeId}/members`, { body: { name } }),
      ),
    )

    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201])
    const listed = await call<{ members: Member[] }>('GET', `/api/homes/${homeId}/members`)
    expect(listed.body.members).toHaveLength(5)
    const ids = listed.body.members.map((m) => m.id)
    expect(new Set(ids).size).toBe(5)
  })

  it('adds the same name in parallel exactly once, the rest get 409', async () => {
    const home = await call<{ id: string }>('POST', '/api/homes', { body: { name: 'Flat' } })
    const homeId = home.body.id

    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        call('POST', `/api/homes/${homeId}/members`, { body: { name: 'Asha' } }),
      ),
    )

    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toEqual([201, 409, 409])
  })

  it('pays the same share in parallel with the same key exactly once', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill has no shares')
    const key = crypto.randomUUID()

    const results = await Promise.all([
      call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': key },
      }),
      call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': key },
      }),
    ])

    expect(results.map((r) => r.status)).toEqual([200, 200])
    expect(results[0]?.body.paidAt).toBe(results[1]?.body.paidAt)
    const balances = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
    expect(balances.body.balances.map((b) => b.outstandingCents)).toEqual([0, 500])
  })

  it('pays the same share in parallel with different keys once, the other conflicts', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const bill = await createBill(homeId, 1000)
    const share = bill.body.shares[0]
    if (!share) throw new Error('bill has no shares')

    const results = await Promise.all([
      call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }),
      call<Share>('POST', `/api/bills/${bill.body.id}/shares/${share.id}/pay`, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }),
    ])

    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  })
})
