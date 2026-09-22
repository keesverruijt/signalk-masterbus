/**
 * The editor talks to the plugin's router, which proxies `/api/*` to the
 * daemon with the token added. Signal K's own login (cookie) covers it.
 */
import type {
  ApplyResult,
  Device,
  Diagnostic,
  FieldMapping,
  Mapping,
  MappingResult,
  Menu,
  Status,
  Suggestion,
  Validation
} from '../src/types.js'

const BASE = '/plugins/signalk-masterbus'

export interface Summary {
  versions?: { plugin: string; daemon: string }
  mode: 'bundled' | 'external' | null
  connected: boolean
  daemon: { running: boolean; recentLog: string[] } | null
  status: Status | null
  error: string | null
  stream: { connected: boolean; deltas: number; values: number } | null
  putPaths: string[]
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { error: text }
  }
  if (!res.ok) {
    const e = (parsed ?? {}) as { error?: unknown }
    throw new Error(typeof e.error === 'string' ? e.error : `HTTP ${res.status}`)
  }
  return parsed as T
}

export const api = {
  summary: () => call<Summary>('GET', '/status'),
  devices: () => call<Device[]>('GET', '/api/devices'),
  device: (serial: string, menu?: Menu) =>
    call<Device>('GET', `/api/devices/${encodeURIComponent(serial)}${menu ? `?menu=${menu}` : ''}`),
  readValue: (serial: string, field: string) =>
    call<{ value: unknown }>(
      'GET',
      `/api/devices/${encodeURIComponent(serial)}/fields/${field}/value`
    ),
  mapping: () => call<Mapping>('GET', '/api/mapping'),
  putMapping: (m: Mapping) => call<MappingResult>('PUT', '/api/mapping', m),
  diagnostics: () => call<Diagnostic[]>('GET', '/api/mapping/diagnostics'),
  suggest: (serial: string, field: string) =>
    call<Suggestion>('POST', '/api/mapping/suggest', { serial, field }),
  validate: (serial: string, field: string, entry: FieldMapping) =>
    call<Validation>('POST', '/api/mapping/validate', { serial, field, entry }),
  applyArticle: (serial: string) =>
    call<ApplyResult>('POST', '/api/mapping/apply-article', { serial })
}
