import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'

import { DaemonClient } from '../src/client.js'
import { DaemonError } from '../src/types.js'

let server: http.Server | null = null
afterEach(() => {
  server?.close()
  server = null
})

interface Seen {
  method: string
  url: string
  auth: string | undefined
  body: string
}

function serve(
  handler: (seen: Seen) => { status: number; body: unknown }
): Promise<{ port: number; seen: Seen[] }> {
  const seen: Seen[] = []
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString()))
      req.on('end', () => {
        const s = {
          method: req.method ?? '',
          url: req.url ?? '',
          auth: req.headers.authorization,
          body
        }
        seen.push(s)
        const out = handler(s)
        res.writeHead(out.status, { 'Content-Type': 'application/json' })
        res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body))
      })
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server?.address() as { port: number }).port, seen })
    })
  })
}

const endpoint = (port: number) => ({
  host: '127.0.0.1',
  apiPort: port,
  streamPort: 0,
  token: 'tok'
})

describe('DaemonClient', () => {
  it('sends the bearer token and JSON bodies, and parses answers', async () => {
    const { port, seen } = await serve((s) => {
      if (s.url === '/api/status') return { status: 200, body: { apiVersion: 1, devices: 3 } }
      if (s.url === '/api/mapping/suggest')
        return { status: 200, body: { path: 'electrical.', tier: null } }
      return { status: 404, body: { error: 'nope' } }
    })
    const c = new DaemonClient(endpoint(port))
    const status = await c.status()
    expect(status.devices).toBe(3)
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/status', auth: 'Bearer tok' })
    const s = await c.suggest('SER', '0x001')
    expect(s.path).toBe('electrical.')
    expect(seen[1]).toMatchObject({ method: 'POST', url: '/api/mapping/suggest' })
    expect(JSON.parse(seen[1]?.body ?? '')).toEqual({ serial: 'SER', field: '0x001' })
    const w = await c
      .writeValue('SER', '0x001', true, { level: 'installer', code: 1 })
      .catch((e: unknown) => e)
    expect(w).toBeInstanceOf(DaemonError)
    expect((w as DaemonError).status).toBe(404)
    expect((w as DaemonError).message).toBe('nope')
    expect(JSON.parse(seen[2]?.body ?? '')).toEqual({
      value: true,
      login: { level: 'installer', code: 1 }
    })
    expect(seen[2]?.url).toBe('/api/devices/SER/fields/0x001')
  })

  it('refuses a daemon with another API version', async () => {
    const { port } = await serve(() => ({ status: 200, body: { apiVersion: 7 } }))
    await expect(new DaemonClient(endpoint(port)).status()).rejects.toThrow('API version 7')
  })

  it('carries the "needs" hint and copes with non-JSON errors', async () => {
    const { port } = await serve((s) =>
      s.url.endsWith('/value')
        ? { status: 502, body: 'gateway said no' }
        : { status: 403, body: { error: 'read-only', needs: 'login' } }
    )
    const c = new DaemonClient(endpoint(port))
    const e = (await c.writeValue('S', '0x1', 1).catch((x: unknown) => x)) as DaemonError
    expect(e.needs).toBe('login')
    expect(e.status).toBe(403)
    const g = (await c.readValue('S', '0x1').catch((x: unknown) => x)) as DaemonError
    expect(g.message).toBe('gateway said no')
    const raw = await c.raw('GET', '/api/devices/S/fields/0x1/value')
    expect(raw).toEqual({ status: 502, body: { error: 'gateway said no' } })
  })
})
