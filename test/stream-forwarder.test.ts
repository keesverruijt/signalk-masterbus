import net from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StreamForwarder, strip } from '../src/stream-forwarder.js'

let server: net.Server | null = null

afterEach(() => {
  server?.close()
  server = null
})

function listen(onConnection: (socket: net.Socket) => void): Promise<number> {
  return new Promise((resolve) => {
    server = net.createServer(onConnection)
    server.listen(0, '127.0.0.1', () => {
      resolve((server?.address() as net.AddressInfo).port)
    })
  })
}

const delta = {
  updates: [
    {
      $source: 'masterbus',
      timestamp: '2026-09-22T10:00:00.000Z',
      values: [{ path: 'electrical.batteries.house.voltage', value: 25.6 }]
    }
  ]
}

describe('strip', () => {
  it('drops $source and timestamp and keeps values and meta', () => {
    const out = strip({
      updates: [
        { $source: 'x', timestamp: 't', values: [{ path: 'a', value: 1 }] },
        { $source: 'x', meta: [{ path: 'a', value: { units: 'V' } }] },
        { $source: 'x', timestamp: 't' }
      ]
    })
    expect(out).toEqual({
      updates: [
        { values: [{ path: 'a', value: 1 }] },
        { meta: [{ path: 'a', value: { units: 'V' } }] }
      ]
    })
  })

  it('rejects anything that is not a delta with updates', () => {
    expect(strip(null)).toBeNull()
    expect(strip('hello')).toBeNull()
    expect(strip({ hello: 1 })).toBeNull()
    expect(strip({ updates: [{ $source: 'x' }] })).toBeNull()
  })
})

describe('StreamForwarder', () => {
  it('republishes each line through handleMessage without the source', async () => {
    const port = await listen((socket) => {
      socket.write(`${JSON.stringify(delta)}\nnot json\n\n`)
    })
    const app = { handleMessage: vi.fn() }
    const f = new StreamForwarder(app, { pluginId: 'p', host: '127.0.0.1', port, reconnectMs: 50 })
    f.start()
    await vi.waitFor(() => {
      expect(app.handleMessage).toHaveBeenCalledTimes(1)
    })
    expect(app.handleMessage).toHaveBeenCalledWith('p', {
      updates: [{ values: [{ path: 'electrical.batteries.house.voltage', value: 25.6 }] }]
    })
    expect(f.counts).toEqual({ deltas: 1, values: 1 })
    expect(f.connected).toBe(true)
    f.stop()
    expect(f.connected).toBe(false)
  })

  it('reconnects after the daemon drops the connection', async () => {
    let connections = 0
    const port = await listen((socket) => {
      connections++
      socket.write(`${JSON.stringify(delta)}\n`)
      socket.end()
    })
    const app = { handleMessage: vi.fn() }
    const f = new StreamForwarder(app, { pluginId: 'p', host: '127.0.0.1', port, reconnectMs: 20 })
    f.start()
    await vi.waitFor(() => {
      expect(connections).toBeGreaterThanOrEqual(2)
    })
    f.stop()
    const seen = connections
    await new Promise((r) => setTimeout(r, 60))
    expect(connections).toBe(seen)
  })

  it('survives a handleMessage that throws', () => {
    const app = {
      handleMessage: vi.fn(() => {
        throw new Error('boom')
      })
    }
    const debug = vi.fn()
    const f = new StreamForwarder(app, { pluginId: 'p', host: '127.0.0.1', port: 1, debug })
    f.forward(JSON.stringify(delta))
    expect(debug).toHaveBeenCalledWith('handleMessage failed: boom')
    expect(f.counts.deltas).toBe(0)
  })
})
