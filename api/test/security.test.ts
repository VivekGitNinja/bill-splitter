import { describe, expect, it } from 'vitest'
import { call, callRaw } from './helpers'

const WEB_ORIGIN = 'http://localhost:5173'

describe('CORS', () => {
  it('answers a preflight OPTIONS request for the web origin', async () => {
    const preflight = await callRaw('OPTIONS', '/api/homes', {
      headers: {
        Origin: WEB_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, idempotency-key',
      },
    })

    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN)
    expect(preflight.headers.get('access-control-allow-methods') ?? '').toContain('POST')
  })

  it('allows a cross-origin GET from the web origin', async () => {
    const health = await callRaw('GET', '/api/health', {
      headers: { Origin: WEB_ORIGIN },
    })

    expect(health.status).toBe(200)
    expect(health.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN)
  })

  it('does not allow an unknown origin', async () => {
    const health = await callRaw('GET', '/api/health', {
      headers: { Origin: 'https://evil.example.com' },
    })

    expect(health.status).toBe(200)
    expect(health.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('security headers', () => {
  it('sets security headers on API responses', async () => {
    const health = await callRaw('GET', '/api/health')

    expect(health.headers.get('x-content-type-options')).toBe('nosniff')
    expect(health.headers.get('x-frame-options')).toBe('SAMEORIGIN')
  })
})

describe('abuse limits', () => {
  it('rejects a body larger than 16 KB with 413', async () => {
    const huge = await call('POST', '/api/homes', {
      body: { name: 'x'.repeat(20_000) },
    })

    expect(huge.status).toBe(413)
    expect(huge.body).toEqual({ error: 'request body is too large' })
  })

  it('rate-limits bursts from one IP with 429', async () => {
    const ip = '203.0.113.99'
    const statuses: number[] = []
    for (let i = 0; i < 61; i++) {
      const response = await call('POST', '/api/homes', {
        body: { name: `Rate home ${i}` },
        headers: { 'CF-Connecting-IP': ip },
      })
      statuses.push(response.status)
    }

    expect(statuses.slice(0, 60).every((status) => status === 201)).toBe(true)
    expect(statuses[60]).toBe(429)
  })

  it('does not rate-limit requests without a client IP', async () => {
    // Local dev and the test suite send no CF-Connecting-IP header, so
    // normal use is never throttled by the per-IP limiter.
    const home = await call('POST', '/api/homes', { body: { name: 'No IP home' } })
    expect(home.status).toBe(201)
  })
})
