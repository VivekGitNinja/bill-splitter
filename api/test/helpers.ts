import { exports } from 'cloudflare:workers'
import type { Bill, Member } from '@bill-splitter/shared'

export type { Balance, Bill, Member, Share } from '@bill-splitter/shared'

export async function call<Body = unknown>(
  method: 'GET' | 'POST',
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
) {
  const response = await exports.default.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  )
  const text = await response.text()
  return { status: response.status, body: parseJson(text) as Body }
}

// Sends the body exactly as given (no JSON encoding), for tests that need a
// malformed body, an oversized body, or a non-GET/POST method like OPTIONS.
export async function callRaw(
  method: 'GET' | 'POST' | 'OPTIONS',
  path: string,
  options: { body?: string; headers?: Record<string, string> } = {},
) {
  const response = await exports.default.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { ...options.headers },
      body: options.body,
    }),
  )
  const text = await response.text()
  return { status: response.status, body: parseJson(text) as unknown, headers: response.headers }
}

// A route that does not exist answers with plain text, so a failed parse gives null.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function createHome(memberNames: string[]) {
  const home = await call<{ id: string; name: string }>('POST', '/api/homes', {
    body: { name: 'Test home' },
  })
  const members: Member[] = []
  for (const name of memberNames) {
    const member = await call<Member>('POST', `/api/homes/${home.body.id}/members`, {
      body: { name },
    })
    members.push(member.body)
  }
  return { homeId: home.body.id, members }
}

export async function createBill(homeId: string, totalCents: number) {
  return call<Bill>('POST', `/api/homes/${homeId}/bills`, {
    body: { title: 'Electricity', totalCents },
  })
}
