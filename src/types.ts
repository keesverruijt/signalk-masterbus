/**
 * The shapes of the daemon's control API, as `docs/API.md` in the masterbus
 * repository documents them. `API_VERSION` is what this plugin was written
 * against; a daemon reporting another value is refused.
 */

export const API_VERSION = 1

export type Menu = 'monitoring' | 'configuration' | 'service'

export interface Status {
  apiVersion: number
  version: string
  transport: string
  stream: string
  api: string
  uptime: number
  devices: number
  mapped: { devices: number; fields: number }
  streaming: number
  clients: number
  diagnostics: { errors: number; warnings: number }
}

export interface Field {
  /** `0x000`..`0x1FF` */
  id: string
  name: string
  unit: string
  options: string[]
  writable: boolean
  menu: Menu
  group: string
  /** The mapped Signal K path, or null. */
  path: string | null
  put: boolean
  /** Last value seen, in the device's own unit, or null. */
  value: unknown
}

export interface Device {
  /** Bus address, six hex digits. */
  id: string
  serial: string
  article: string
  name: string
  firmware: string
  instance: string
  menus: Menu[]
  mapped: number
  fields: Field[]
}

export type NotifyState = 'alert' | 'warn' | 'alarm' | 'emergency'

export interface FieldMapping {
  path: string
  invert?: boolean
  truth?: Record<string, boolean>
  notify?: Record<string, NotifyState>
  put?: boolean
}

export interface DeviceMapping {
  article?: string
  firmware?: string
  name?: string
  instance?: string
  fields: Record<string, FieldMapping>
}

export interface Mapping {
  version: number
  devices: Record<string, DeviceMapping>
}

export type Severity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  severity: Severity
  serial: string
  device: string
  field?: string
  path?: string
  message: string
}

export interface MappingResult {
  mapped: number
  streaming: number
  diagnostics: Diagnostic[]
}

export interface ApplyResult extends MappingResult {
  targets: number
  copied: number
  skipped: number
}

export type Tier = 'existing' | 'modelFirmware' | 'model' | 'name' | null

export interface Suggestion {
  path: string
  invert: boolean
  tier: Tier
  truthDefault: Record<string, boolean> | null
  notifyDefault: Record<string, NotifyState>
}

export type Validation =
  | {
      ok: true
      unit: string | null
      conversion: string
      boolean: boolean
      truth: Record<string, boolean>
      notify: Record<string, NotifyState>
      invert: boolean
      warnings: string[]
    }
  | {
      ok: false
      refusal: {
        kind: 'path' | 'units' | 'truth' | 'empty'
        message: string
        labels?: string[]
        /** For `truth`: what the conventional label meanings already say. */
        truthPartial?: Record<string, boolean>
        /** For `truth` on three or more labels: the mode leaf to prefer. */
        hint?: string | null
      }
    }

export interface Login {
  level: 'installer' | 'distributor' | 'mvservice'
  code: number
}

export interface WriteResult {
  applied: unknown
  published: unknown
}

/** An error the daemon answered with, carrying its status and message. */
export class DaemonError extends Error {
  readonly status: number
  /** `"login"` when a write was refused for lack of access level. */
  readonly needs?: string

  constructor(status: number, message: string, needs?: string) {
    super(message)
    this.name = 'DaemonError'
    this.status = status
    this.needs = needs
  }
}
