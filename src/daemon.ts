import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

import type { BundledConfig } from './config.js'

/** The directory under `bin/` that carries this platform's daemon. */
export function platformDir(
  platform: string = process.platform,
  arch: string = process.arch
): string {
  return `${platform}-${arch}`
}

/**
 * Where the daemon binary is: the configured path if any, else the bundled
 * one under `bin/<os>-<arch>/` next to `plugin/` (put there by
 * `scripts/fetch-daemons.mjs` before publishing). Throws with a message fit
 * for the plugin status when neither exists.
 */
export function resolveBinary(binaryPath: string, from: string = import.meta.url): string {
  if (binaryPath.trim()) {
    const p = binaryPath.trim()
    if (!fs.existsSync(p)) throw new Error(`the configured binary ${p} does not exist`)
    return p
  }
  const exe = process.platform === 'win32' ? 'masterbus-signalk.exe' : 'masterbus-signalk'
  const root = path.resolve(path.dirname(fileURLToPath(from)), '..')
  const bin = path.join(root, 'bin', platformDir(), exe)
  if (!fs.existsSync(bin)) {
    throw new Error(
      `no bundled daemon for ${platformDir()} (${bin} is missing; in a development checkout ` +
        'run `npm run fetch-daemons`); set a binary path, or use external mode'
    )
  }
  return bin
}

/**
 * The `config.ini` the daemon reads, rendered from the plugin's settings.
 * With transport `auto` and a file already present, the file is left alone:
 * the daemon auto-detected it on first run and the user may have edited it.
 * Ports and the API address are always ours, so those keys are rewritten.
 */
export function renderConfigIni(cfg: BundledConfig, existing: string | null): string | null {
  const ownKeys = ['listen', 'api_listen', 'api_token']
  const managed = (body: string): string =>
    body
      .split('\n')
      .filter((line) => {
        const key = line.split('=')[0]?.trim().replace(/^#\s*/, '')
        return !(key && ownKeys.includes(key))
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd()
  const ours =
    `\n# Managed by the Signal K plugin (signalk-masterbus); edit ports there.\n` +
    `listen = 127.0.0.1:${cfg.streamPort}\n` +
    `api_listen = 127.0.0.1:${cfg.apiPort}\n`
  if (cfg.transport === 'auto') {
    if (existing === null) return null // let the daemon auto-detect and write it
    return `${managed(existing)}\n${ours}`
  }
  const hb = cfg.heartbeatMaster.trim()
  return (
    '# masterbus configuration, written by the Signal K plugin (signalk-masterbus).\n' +
    '# Transport, device and master role are edited in the plugin settings.\n' +
    (hb ? `heartbeat_master = ${hb}\n` : '# heartbeat_master = 000001\n') +
    `device_type = ${cfg.transport}\n` +
    `device_name = ${cfg.deviceName.trim()}\n` +
    ours
  )
}

export interface DaemonEvents {
  /** A line of the daemon's stderr. */
  log(line: string): void
  /** The daemon exited; `restartIn` is null when it will not be restarted. */
  exited(code: number | null, signal: string | null, restartIn: number | null): void
  /** The daemon is up again after a restart. */
  ready(): void
}

export interface DaemonOptions {
  binary: string
  /** Where config.ini, mapping.json and the schema cache live. */
  dataDir: string
  config: BundledConfig
  events: DaemonEvents
  /** Extra arguments, e.g. `['--fake-bus']` in tests. */
  extraArgs?: string[]
  /** How long to wait for READY before giving up, ms. */
  readyTimeoutMs?: number
}

const KEEP_LINES = 40

/**
 * Runs `masterbus-signalk` as a child process: renders its config and token,
 * spawns it with `--config-dir`, waits for the `READY` line, and restarts
 * it with backoff if it exits. `stop()` ends it for good.
 */
export class DaemonManager {
  readonly token: string
  private readonly opts: DaemonOptions
  private child: ChildProcess | null = null
  private stopping = false
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private backoffMs = 1000
  private readonly recent: string[] = []
  private generation = 0

  constructor(opts: DaemonOptions) {
    this.opts = opts
    this.token = randomBytes(24).toString('hex')
  }

  /** The last lines the daemon wrote to stderr, for an error status. */
  get recentLog(): string[] {
    return [...this.recent]
  }

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null && !this.child.killed
  }

  /** Start the daemon and resolve once it reports READY. */
  async start(): Promise<void> {
    this.stopping = false
    fs.mkdirSync(this.opts.dataDir, { recursive: true })
    const ini = path.join(this.opts.dataDir, 'config.ini')
    const existing = fs.existsSync(ini) ? fs.readFileSync(ini, 'utf8') : null
    const rendered = renderConfigIni(this.opts.config, existing)
    if (rendered !== null && rendered !== existing) fs.writeFileSync(ini, rendered)
    const tokenFile = path.join(this.opts.dataDir, 'api-token')
    fs.writeFileSync(tokenFile, this.token, { mode: 0o600 })
    await this.spawnOnce(tokenFile)
  }

  private spawnOnce(tokenFile: string): Promise<void> {
    const generation = ++this.generation
    const { config } = this.opts
    const args = [
      '--config-dir',
      this.opts.dataDir,
      '--stream',
      `127.0.0.1:${config.streamPort}`,
      '--api',
      `127.0.0.1:${config.apiPort}`,
      '--api-token-file',
      tokenFile,
      ...(this.opts.extraArgs ?? [])
    ]
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const child = spawn(this.opts.binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? 'warn' }
      })
      this.child = child
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error(`the daemon did not report READY within ${this.readyTimeout() / 1000} s`))
      }, this.readyTimeout())

      // Both pipes exist: stdio is ['ignore', 'pipe', 'pipe'] above.
      readline
        .createInterface({ input: child.stdout as NodeJS.ReadableStream })
        .on('line', (line) => {
          if (line.startsWith('READY')) {
            this.backoffMs = 1000
            if (!settled) {
              settled = true
              clearTimeout(timeout)
              resolve()
            } else {
              this.opts.events.ready()
            }
          }
        })
      readline
        .createInterface({ input: child.stderr as NodeJS.ReadableStream })
        .on('line', (line) => {
          this.recent.push(line)
          if (this.recent.length > KEEP_LINES) this.recent.shift()
          this.opts.events.log(line)
        })
      child.on('error', (err) => {
        this.recent.push(`spawn: ${err.message}`)
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(err)
        }
      })
      child.on('exit', (code, signal) => {
        if (generation !== this.generation) {
          // Superseded by stop() or a later start(): report, never restart.
          this.opts.events.exited(code, signal, null)
          return
        }
        this.child = null
        const restartIn = this.stopping ? null : this.backoffMs
        this.opts.events.exited(code, signal, restartIn)
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(new Error(`the daemon exited with ${code ?? signal ?? 'no status'} before READY`))
          return
        }
        if (restartIn !== null) {
          this.restartTimer = setTimeout(() => {
            this.restartTimer = null
            if (this.stopping) return
            this.spawnOnce(tokenFile).catch((err: unknown) => {
              this.opts.events.log(`restart failed: ${errMsg(err)}`)
            })
          }, restartIn)
          this.backoffMs = Math.min(this.backoffMs * 2, 60_000)
        }
      })
    })
  }

  private readyTimeout(): number {
    return this.opts.readyTimeoutMs ?? 30_000
  }

  /** Stop the daemon: SIGTERM, then SIGKILL after a grace period. */
  async stop(graceMs = 5000): Promise<void> {
    this.stopping = true
    this.generation++
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      const killer = setTimeout(() => {
        child.kill('SIGKILL')
      }, graceMs)
      child.once('exit', () => {
        clearTimeout(killer)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
