// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createBill, formatCents, payShare } from './api'

// The API client is tested with a stubbed fetch, so no server is needed.
// (No jest-dom here: assertions use plain DOM properties instead of
// jest-dom matchers.)

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function errorResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('formatCents', () => {
  it('formats whole dollars and cents with Intl', () => {
    expect(formatCents(1000)).toBe('$10.00')
    expect(formatCents(334)).toBe('$3.34')
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(1)).toBe('$0.01')
  })
})

describe('error mapping', () => {
  it('surfaces the API error message and status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => errorResponse(422, { error: 'totalCents must be a positive number' })),
    )

    await expect(createBill('home-1', 'Rent', 0)).rejects.toMatchObject({
      status: 422,
      message: 'totalCents must be a positive number',
    })
  })

  it('falls back to a status message when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json')
        },
      })),
    )

    await expect(createBill('home-1', 'Rent', 100)).rejects.toMatchObject({
      status: 500,
      message: 'Request failed with status 500',
    })
  })

  it('maps an abort to a timeout error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError')
      }),
    )

    const error = await createBill('home-1', 'Rent', 100).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(0)
    expect((error as ApiError).message).toContain('timed out')
  })

  it('maps a network failure to a connection error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    const error = await createBill('home-1', 'Rent', 100).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(0)
    expect((error as ApiError).message).toContain('Could not reach the API')
  })

  it('sends JSON with the right path and method', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      okResponse({ id: 'home-1', name: 'Flat' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await createBill('home-1', 'Rent', 100)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/homes/home-1/bills')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ title: 'Rent', totalCents: 100 }))
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('payShare idempotency keys', () => {
  it('reuses the same key when a payment is retried after a failure', async () => {
    const keys: (string | undefined)[] = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      keys.push(headers['Idempotency-Key'])
      if (keys.length === 1) throw new Error('network down')
      return okResponse({
        id: 'share-1',
        memberId: 'member-1',
        amountCents: 300,
        paidAt: '2026-11-08T00:00:00.000Z',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(payShare('bill-1', 'share-1')).rejects.toBeInstanceOf(ApiError)
    const paid = await payShare('bill-1', 'share-1')

    expect(paid.paidAt).toBe('2026-11-08T00:00:00.000Z')
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[0]).toBe(keys[1])
  })

  it('uses a fresh key for a new payment after a success', async () => {
    const keys: (string | undefined)[] = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      keys.push(headers['Idempotency-Key'])
      return okResponse({
        id: 'share-1',
        memberId: 'member-1',
        amountCents: 300,
        paidAt: '2026-11-08T00:00:00.000Z',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await payShare('bill-1', 'share-1')
    await payShare('bill-1', 'share-1')

    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })
})
