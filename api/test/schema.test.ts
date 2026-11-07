import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

// The schema's named constraints are the last line of defence: even if the
// API ever has a bug, the database itself must refuse orphan rows.
describe('foreign keys', () => {
  it('rejects a member for a home that does not exist', async () => {
    await expect(
      env.DB.prepare('INSERT INTO members (id, home_id, name, seq) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), crypto.randomUUID(), 'Orphan', 1)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/i)
  })

  it('rejects a bill for a home that does not exist', async () => {
    await expect(
      env.DB.prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), crypto.randomUUID(), 'Orphan bill', 100)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/i)
  })

  it('rejects a share for a bill that does not exist', async () => {
    await expect(
      env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at, idempotency_key) VALUES (?, ?, ?, ?, NULL, NULL)',
      )
        .bind(crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), 100)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/i)
  })
})

describe('indexes and timestamps', () => {
  it('has the lookup indexes from migration 0002', async () => {
    const result = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'",
    ).all<{ name: string }>()
    const names = result.results.map((row) => row.name)
    expect(names).toEqual(
      expect.arrayContaining(['idx_bills_home_id', 'idx_shares_bill_id', 'idx_shares_member_id']),
    )
  })

  it('has a created_at column on every table', async () => {
    for (const table of ['homes', 'members', 'bills', 'shares']) {
      const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
      const columns = result.results.map((row) => row.name)
      expect(columns).toContain('created_at')
    }
  })

  it('fills created_at automatically', async () => {
    const homeId = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)')
      .bind(homeId, 'Timestamp home')
      .run()
    const row = await env.DB.prepare('SELECT created_at FROM homes WHERE id = ?')
      .bind(homeId)
      .first<{ created_at: string }>()
    expect(row?.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})
