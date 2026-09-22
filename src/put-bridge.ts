import type { ActionResult } from '@signalk/server-api'

import { DaemonError, type Login, type Mapping } from './types.js'

/** The slice of the server the bridge needs. */
export interface PutBridgeApp {
  registerPutHandler(
    context: string,
    path: string,
    callback: (
      context: string,
      path: string,
      value: unknown,
      cb: (result: ActionResult) => void
    ) => ActionResult,
    source?: string
  ): void
  debug?(msg: string): void
}

/** The slice of the client the bridge needs. */
export interface PutBridgeClient {
  writeValue(
    serial: string,
    field: string,
    value: unknown,
    login?: Login
  ): Promise<{ applied: unknown; published: unknown }>
}

interface Target {
  serial: string
  field: string
}

/**
 * Turns the mapping's `"put": true` entries into Signal K PUT handlers.
 *
 * The server has no way to unregister a handler, so one is registered per
 * path the first time it is seen and stays; what it does is looked up in a
 * live table on every call. A path that is no longer a put target answers
 * with a 404-style failure rather than writing to a stale field.
 *
 * A write refused for lack of access level is retried once with the
 * installer code when one is configured.
 */
export class PutBridge {
  private readonly app: PutBridgeApp
  private readonly client: PutBridgeClient
  private readonly pluginId: string
  private readonly targets = new Map<string, Target>()
  private readonly registered = new Set<string>()
  private installerCode: number | null = null

  constructor(app: PutBridgeApp, client: PutBridgeClient, pluginId: string) {
    this.app = app
    this.client = client
    this.pluginId = pluginId
  }

  setInstallerCode(code: number | null): void {
    this.installerCode = code
  }

  /** The paths currently accepting PUTs. */
  get paths(): string[] {
    return [...this.targets.keys()].sort()
  }

  /** Bring the live table in line with a mapping; returns what changed. */
  sync(mapping: Mapping): { added: string[]; removed: string[] } {
    const next = new Map<string, Target>()
    for (const [serial, dm] of Object.entries(mapping.devices)) {
      for (const [field, fm] of Object.entries(dm.fields)) {
        if (fm.put && fm.path) next.set(fm.path, { serial, field })
      }
    }
    const added: string[] = []
    const removed: string[] = []
    for (const path of this.targets.keys()) if (!next.has(path)) removed.push(path)
    for (const [path, target] of next) {
      if (!this.targets.has(path)) added.push(path)
      this.targets.set(path, target)
    }
    for (const path of removed) this.targets.delete(path)
    for (const path of added) {
      if (this.registered.has(path)) continue
      this.registered.add(path)
      this.app.registerPutHandler('vessels.self', path, this.handler, this.pluginId)
    }
    return { added: added.sort(), removed: removed.sort() }
  }

  /** Drop every target (the plugin is stopping); registrations remain. */
  clear(): void {
    this.targets.clear()
  }

  private readonly handler = (
    _context: string,
    path: string,
    value: unknown,
    cb: (result: ActionResult) => void
  ): ActionResult => {
    const target = this.targets.get(path)
    if (!target) {
      return {
        state: 'COMPLETED',
        statusCode: 404,
        message: `${path} is not a MasterBus PUT target`
      }
    }
    void this.write(target, value)
      .then((r) => {
        cb(r)
      })
      .catch((err: unknown) => {
        cb({ state: 'COMPLETED', statusCode: 500, message: errMsg(err) })
      })
    return { state: 'PENDING' }
  }

  private async write(target: Target, value: unknown): Promise<ActionResult> {
    try {
      await this.client.writeValue(target.serial, target.field, value)
      return { state: 'COMPLETED', statusCode: 200 }
    } catch (err) {
      if (err instanceof DaemonError && err.needs === 'login' && this.installerCode !== null) {
        this.app.debug?.(
          `${target.serial} ${target.field}: read-only; retrying with installer login`
        )
        try {
          await this.client.writeValue(target.serial, target.field, value, {
            level: 'installer',
            code: this.installerCode
          })
          return { state: 'COMPLETED', statusCode: 200 }
        } catch (again) {
          return failure(again)
        }
      }
      return failure(err)
    }
  }
}

function failure(err: unknown): ActionResult {
  if (err instanceof DaemonError) {
    const statusCode = err.status >= 400 && err.status < 600 ? err.status : 502
    return { state: 'COMPLETED', statusCode, message: err.message }
  }
  return { state: 'COMPLETED', statusCode: 502, message: errMsg(err) }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
