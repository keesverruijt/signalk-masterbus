import {
  API_VERSION,
  DaemonError,
  type ApplyResult,
  type Device,
  type Diagnostic,
  type FieldMapping,
  type Login,
  type Mapping,
  type MappingResult,
  type Menu,
  type Status,
  type Suggestion,
  type Validation,
  type WriteResult
} from './types.js'

export interface Endpoint {
  host: string
  apiPort: number
  streamPort: number
  token: string
}

/**
 * A typed client for the daemon's control API. Every method maps to one
 * endpoint in `docs/API.md`; a non-2xx answer becomes a `DaemonError` with
 * the daemon's own message.
 */
export class DaemonClient {
  readonly endpoint: Endpoint
  private readonly fetchImpl: typeof fetch

  constructor(endpoint: Endpoint, fetchImpl: typeof fetch = fetch) {
    this.endpoint = endpoint
    this.fetchImpl = fetchImpl
  }

  get baseUrl(): string {
    return `http://${this.endpoint.host}:${this.endpoint.apiPort}`
  }

  /** Raw request, for the router's proxy. Returns the status and body. */
  async raw(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = {}
    if (this.endpoint.token) headers.Authorization = `Bearer ${this.endpoint.token}`
    let payload: string | undefined
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = typeof body === 'string' ? body : JSON.stringify(body)
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body: payload })
    const text = await res.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = { error: text }
      }
    }
    return { status: res.status, body: parsed }
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { status, body: parsed } = await this.raw(method, path, body)
    if (status < 200 || status >= 300) {
      const e = (parsed ?? {}) as { error?: unknown; needs?: unknown }
      const message = typeof e.error === 'string' ? e.error : `HTTP ${status} from the daemon`
      throw new DaemonError(status, message, typeof e.needs === 'string' ? e.needs : undefined)
    }
    return parsed as T
  }

  /** `GET /api/status`, refusing a daemon whose API version is not ours. */
  async status(): Promise<Status> {
    const s = await this.call<Status>('GET', '/api/status')
    if (s.apiVersion !== API_VERSION) {
      throw new DaemonError(
        0,
        `the daemon speaks API version ${s.apiVersion}, this plugin version ${API_VERSION}; ` +
          'update whichever is older'
      )
    }
    return s
  }

  devices(): Promise<Device[]> {
    return this.call('GET', '/api/devices')
  }

  device(serial: string, menu?: Menu): Promise<Device> {
    const q = menu ? `?menu=${menu}` : ''
    return this.call('GET', `/api/devices/${encodeURIComponent(serial)}${q}`)
  }

  readValue(serial: string, field: string): Promise<{ value: unknown }> {
    return this.call('GET', `/api/devices/${encodeURIComponent(serial)}/fields/${field}/value`)
  }

  writeValue(serial: string, field: string, value: unknown, login?: Login): Promise<WriteResult> {
    return this.call('PUT', `/api/devices/${encodeURIComponent(serial)}/fields/${field}`, {
      value,
      ...(login ? { login } : {})
    })
  }

  mapping(): Promise<Mapping> {
    return this.call('GET', '/api/mapping')
  }

  putMapping(mapping: Mapping): Promise<MappingResult> {
    return this.call('PUT', '/api/mapping', mapping)
  }

  diagnostics(): Promise<Diagnostic[]> {
    return this.call('GET', '/api/mapping/diagnostics')
  }

  suggest(serial: string, field: string): Promise<Suggestion> {
    return this.call('POST', '/api/mapping/suggest', { serial, field })
  }

  validate(serial: string, field: string, entry: FieldMapping): Promise<Validation> {
    return this.call('POST', '/api/mapping/validate', { serial, field, entry })
  }

  applyArticle(serial: string): Promise<ApplyResult> {
    return this.call('POST', '/api/mapping/apply-article', { serial })
  }
}
