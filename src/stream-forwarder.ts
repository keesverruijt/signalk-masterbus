import net from 'node:net'
import readline from 'node:readline'

import type { Delta } from '@signalk/server-api'

/** The slice of the server the forwarder needs, so tests can pass a stub. */
export interface ForwarderApp {
  handleMessage(id: string, msg: Partial<Delta>): void
}

export interface ForwarderOptions {
  pluginId: string
  host: string
  port: number
  debug?: (msg: string) => void
  reconnectMs?: number
}

/**
 * Reads the daemon's delta stream (newline-delimited Signal K deltas over
 * TCP) and republishes every update through `app.handleMessage`, so the
 * values, unit `meta` and notifications land on the server's own model,
 * attributed to this plugin.
 *
 * `$source` and `timestamp` are dropped from each update: the server stamps
 * both, and keeping the daemon's `$source` would make the data look like it
 * came from a provider the admin UI cannot find.
 *
 * Reconnects with a fixed interval; the daemon replays the static metadata
 * and notification states on every new connection, so nothing is lost.
 */
export class StreamForwarder {
  private readonly app: ForwarderApp
  private readonly opts: Required<ForwarderOptions>
  private socket: net.Socket | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private _connected = false
  private _deltas = 0
  private _values = 0

  constructor(app: ForwarderApp, opts: ForwarderOptions) {
    this.app = app
    this.opts = {
      debug: () => {},
      reconnectMs: 3000,
      ...opts
    }
  }

  get connected(): boolean {
    return this._connected
  }

  /** Deltas and value entries forwarded so far. */
  get counts(): { deltas: number; values: number } {
    return { deltas: this._deltas, values: this._values }
  }

  start(): void {
    this.closed = false
    this.connect()
  }

  stop(): void {
    this.closed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.socket?.destroy()
    this.socket = null
    this._connected = false
  }

  private connect(): void {
    if (this.closed) return
    const { host, port } = this.opts
    this.opts.debug(`connecting to the stream at ${host}:${port}`)
    const socket = net.connect({ host, port })
    this.socket = socket
    socket.setKeepAlive(true, 10_000)
    socket.on('connect', () => {
      this._connected = true
      this.opts.debug('stream connected')
    })
    readline.createInterface({ input: socket }).on('line', (line) => {
      this.forward(line)
    })
    socket.on('error', (err) => {
      this.opts.debug(`stream error: ${err.message}`)
    })
    socket.on('close', () => {
      this._connected = false
      if (this.socket === socket) this.socket = null
      if (!this.closed) this.schedule()
    })
  }

  private schedule(): void {
    if (this.timer || this.closed) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, this.opts.reconnectMs)
  }

  /** One line of the stream. Exposed for tests. */
  forward(line: string): void {
    const text = line.trim()
    if (!text) return
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      this.opts.debug(`stream: not JSON: ${text.slice(0, 80)}`)
      return
    }
    const delta = strip(parsed)
    if (!delta) return
    try {
      this.app.handleMessage(this.opts.pluginId, delta)
      this._deltas++
      for (const u of delta.updates ?? []) {
        this._values += ('values' in u ? u.values.length : 0) + ('meta' in u ? u.meta.length : 0)
      }
    } catch (err) {
      this.opts.debug(`handleMessage failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/**
 * The delta with `$source` and `timestamp` removed from every update, or
 * null when it is not a delta with updates.
 */
export function strip(parsed: unknown): Partial<Delta> | null {
  if (!parsed || typeof parsed !== 'object') return null
  const root = parsed as { updates?: unknown }
  if (!Array.isArray(root.updates)) return null
  const updates: unknown[] = []
  for (const u of root.updates) {
    if (!u || typeof u !== 'object') continue
    const { $source: _s, timestamp: _t, ...rest } = u as Record<string, unknown>
    if (!Array.isArray(rest.values) && !Array.isArray(rest.meta)) continue
    updates.push(rest)
  }
  if (updates.length === 0) return null
  return { updates } as Partial<Delta>
}
