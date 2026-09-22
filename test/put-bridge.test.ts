import type { ActionResult } from '@signalk/server-api'
import { describe, expect, it, vi } from 'vitest'

import { PutBridge, type PutBridgeApp } from '../src/put-bridge.js'
import { DaemonError, type Mapping } from '../src/types.js'

type Handler = (
  context: string,
  path: string,
  value: unknown,
  cb: (result: ActionResult) => void
) => ActionResult

function makeApp(): PutBridgeApp & { handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    registerPutHandler: vi.fn((_ctx: string, path: string, cb: Handler) => {
      handlers.set(path, cb)
    }),
    debug: vi.fn()
  }
}

const mapping = (put: boolean): Mapping => ({
  version: 1,
  devices: {
    'INV-1': {
      fields: {
        '0x013': { path: 'electrical.inverters.msu.enabled', put },
        '0x006': { path: 'electrical.inverters.msu.dc.voltage' }
      }
    }
  }
})

/** Run a handler and wait for its asynchronous result. */
function invoke(handler: Handler, path: string, value: unknown): Promise<ActionResult> {
  return new Promise((resolve) => {
    const first = handler('vessels.self', path, value, resolve)
    if (first.state !== 'PENDING') resolve(first)
  })
}

describe('PutBridge', () => {
  it('registers a handler per put path once and writes through the client', async () => {
    const app = makeApp()
    const client = { writeValue: vi.fn().mockResolvedValue({ applied: false, published: true }) }
    const bridge = new PutBridge(app, client, 'signalk-masterbus')
    expect(bridge.sync(mapping(true))).toEqual({
      added: ['electrical.inverters.msu.enabled'],
      removed: []
    })
    expect(app.registerPutHandler).toHaveBeenCalledTimes(1)
    expect(app.registerPutHandler).toHaveBeenCalledWith(
      'vessels.self',
      'electrical.inverters.msu.enabled',
      expect.any(Function),
      'signalk-masterbus'
    )
    // Syncing the same mapping again changes nothing.
    expect(bridge.sync(mapping(true))).toEqual({ added: [], removed: [] })
    expect(app.registerPutHandler).toHaveBeenCalledTimes(1)

    const handler = app.handlers.get('electrical.inverters.msu.enabled')
    if (!handler) throw new Error('no handler')
    const r = await invoke(handler, 'electrical.inverters.msu.enabled', true)
    expect(r).toEqual({ state: 'COMPLETED', statusCode: 200 })
    expect(client.writeValue).toHaveBeenCalledWith('INV-1', '0x013', true)
  })

  it('answers 404 for a path that is no longer a put target', async () => {
    const app = makeApp()
    const client = { writeValue: vi.fn() }
    const bridge = new PutBridge(app, client, 'p')
    bridge.sync(mapping(true))
    expect(bridge.sync(mapping(false))).toEqual({
      added: [],
      removed: ['electrical.inverters.msu.enabled']
    })
    const handler = app.handlers.get('electrical.inverters.msu.enabled')
    if (!handler) throw new Error('no handler')
    const r = await invoke(handler, 'electrical.inverters.msu.enabled', true)
    expect(r.statusCode).toBe(404)
    expect(client.writeValue).not.toHaveBeenCalled()
    // Mapped again: the old registration serves the new target.
    bridge.sync(mapping(true))
    expect(app.registerPutHandler).toHaveBeenCalledTimes(1)
    expect(bridge.paths).toEqual(['electrical.inverters.msu.enabled'])
  })

  it('retries with the installer code when the daemon asks for a login', async () => {
    const app = makeApp()
    const client = {
      writeValue: vi
        .fn()
        .mockRejectedValueOnce(new DaemonError(403, 'read-only', 'login'))
        .mockResolvedValueOnce({ applied: true, published: true })
    }
    const bridge = new PutBridge(app, client, 'p')
    bridge.setInstallerCode(1234)
    bridge.sync(mapping(true))
    const handler = app.handlers.get('electrical.inverters.msu.enabled')
    if (!handler) throw new Error('no handler')
    const r = await invoke(handler, 'electrical.inverters.msu.enabled', true)
    expect(r).toEqual({ state: 'COMPLETED', statusCode: 200 })
    expect(client.writeValue).toHaveBeenLastCalledWith('INV-1', '0x013', true, {
      level: 'installer',
      code: 1234
    })
  })

  it('reports the daemon error when there is no code to retry with', async () => {
    const app = makeApp()
    const client = {
      writeValue: vi.fn().mockRejectedValue(new DaemonError(403, 'Inverter is read-only', 'login'))
    }
    const bridge = new PutBridge(app, client, 'p')
    bridge.sync(mapping(true))
    const handler = app.handlers.get('electrical.inverters.msu.enabled')
    if (!handler) throw new Error('no handler')
    const r = await invoke(handler, 'electrical.inverters.msu.enabled', true)
    expect(r).toEqual({ state: 'COMPLETED', statusCode: 403, message: 'Inverter is read-only' })
    // A network failure is a gateway error.
    client.writeValue.mockRejectedValue(new Error('ECONNREFUSED'))
    const again = await invoke(handler, 'electrical.inverters.msu.enabled', true)
    expect(again).toEqual({ state: 'COMPLETED', statusCode: 502, message: 'ECONNREFUSED' })
  })
})
