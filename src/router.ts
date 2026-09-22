import type { Request, Response } from 'express'
import type { PluginRouter } from '@signalk/server-api'

import type { DaemonClient } from './client.js'

/** What the router needs from the plugin: the client of the moment. */
export interface RouterState {
  client: () => DaemonClient | null
  /** A one-line summary for `/status`. */
  summary: () => Record<string, unknown>
}

/**
 * Mounts the editor's routes under `/plugins/signalk-masterbus/`:
 *
 * - `/status` — what the plugin knows, for the editor's header.
 * - `/api/*` — proxied to the daemon's control API with the token added, so
 *   the browser never needs to reach the daemon (which in external mode may
 *   be on another host) and Signal K's own login covers it. Reads are open
 *   to read-only users; anything that changes the mapping or writes to the
 *   bus is admin-only, which is the router's default.
 */
export function registerRoutes(router: PluginRouter, state: RouterState): void {
  const proxy = (req: Request, res: Response): void => {
    const client = state.client()
    if (!client) {
      res.status(503).json({ error: 'the MasterBus daemon is not connected' })
      return
    }
    // Everything after `/api` on this router, query string included.
    const tail = req.originalUrl.replace(/^.*?\/api(?=\/|\?|$)/, '')
    const body = req.method === 'GET' ? undefined : (req.body as unknown)
    client
      .raw(req.method, `/api${tail}`, body)
      .then(({ status, body }) => {
        res.status(status).json(body)
      })
      .catch((err: unknown) => {
        res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
      })
  }
  router.access('readonly').get('/status', (_req, res) => {
    res.json(state.summary())
  })
  // Express 4 wildcards (the server's Express): `*` rather than `{*path}`.
  router.access('readonly').get('/api/*', proxy)
  router.put('/api/*', proxy)
  router.post('/api/*', proxy)
}
