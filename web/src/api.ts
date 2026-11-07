// Typed client for the bill splitter API.
//
// The API base URL comes from the VITE_API_URL environment variable. When it
// is empty, requests go to the same origin (in development Vite proxies
// /api to the local Worker). A deployed build sets VITE_API_URL to the
// deployed Worker URL, for example https://bill-splitter-api.example.workers.dev.
// No host is hardcoded here.

import type { Balance, Bill, Member, Share } from '@bill-splitter/shared'

export type { Balance, Bill, Member, Share } from '@bill-splitter/shared'

const rawBase = import.meta.env.VITE_API_URL
const API_BASE = typeof rawBase === 'string' ? rawBase.replace(/\/$/, '') : ''

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, 'The request timed out. The API may be slow, please try again.')
    }
    throw new ApiError(0, 'Could not reach the API. Check your connection and try again.')
  } finally {
    clearTimeout(timeout)
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed with status ${response.status}`
    throw new ApiError(response.status, message)
  }
  return body as T
}

export function createHome(name: string): Promise<{ id: string; name: string }> {
  return request('/api/homes', { method: 'POST', body: JSON.stringify({ name }) })
}

export function listMembers(
  homeId: string,
  page?: { limit?: number; cursor?: string },
): Promise<{ members: Member[]; nextCursor: string | null }> {
  const query = new URLSearchParams()
  if (page?.limit !== undefined) query.set('limit', String(page.limit))
  if (page?.cursor !== undefined) query.set('cursor', page.cursor)
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return request(`/api/homes/${homeId}/members${suffix}`)
}

export function addMember(homeId: string, name: string): Promise<Member> {
  return request(`/api/homes/${homeId}/members`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function listBills(
  homeId: string,
  page?: { limit?: number; cursor?: string },
): Promise<{ bills: Bill[]; nextCursor: string | null }> {
  const query = new URLSearchParams()
  if (page?.limit !== undefined) query.set('limit', String(page.limit))
  if (page?.cursor !== undefined) query.set('cursor', page.cursor)
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return request(`/api/homes/${homeId}/bills${suffix}`)
}

export function createBill(homeId: string, title: string, totalCents: number): Promise<Bill> {
  return request(`/api/homes/${homeId}/bills`, {
    method: 'POST',
    body: JSON.stringify({ title, totalCents }),
  })
}

export function listBalances(homeId: string): Promise<{ balances: Balance[] }> {
  return request(`/api/homes/${homeId}/balances`)
}

// One idempotency key per share, generated on the first attempt and reused
// on every retry of that share. A fresh UUID per call would turn a retry of
// a payment that already landed server-side into a 409; reusing the key
// makes the retry return the original 200 instead. The key is dropped once
// the payment succeeds.
const payKeys = new Map<string, string>()

export function payShare(billId: string, shareId: string): Promise<Share> {
  const cacheKey = `${billId}:${shareId}`
  let key = payKeys.get(cacheKey)
  if (key === undefined) {
    key = crypto.randomUUID()
    payKeys.set(cacheKey, key)
  }
  return request<Share>(`/api/bills/${billId}/shares/${shareId}/pay`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
  }).then((share) => {
    payKeys.delete(cacheKey)
    return share
  })
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatCents(cents: number): string {
  return usd.format(cents / 100)
}
