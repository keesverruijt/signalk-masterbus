import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

import type { BundledConfig } from './config.js'
import { adoptMapping, ENV, inContainer, toolsCacheDir, toolsDir, type Env } from './shared.js'

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

/** Whether a Mastervolt USB link (USB vendor `1a64`) is plugged in, from sysfs. */
export function usbLinkPresent(root = '/sys/bus/usb/devices'): boolean {
  let entries: string[]
  try {
    entries = fs.readdirSync(root)
  } catch {
    return false
  }
  return entries.some((e) => {
    try {
      return fs.readFileSync(path.join(root, e, 'idVendor'), 'utf8').trim() === '1a64'
    } catch {
      return false
    }
  })
}

/** What `renderConfigIni` needs to know about the machine. */
export interface Host {
  platform: string
  usbLink: () => boolean
}

const HOST: Host = { platform: process.platform, usbLink: () => usbLinkPresent() }

export const NO_USB_LINK =
  'No Mastervolt USB link found. If the MasterBus is connected through a CAN interface, set ' +
  'Transport to SocketCAN (Linux) in the plugin settings and enter its name (for example can0) ' +
  'as Device. Auto-detect does not choose a CAN interface by itself, because on most boats that ' +
  'is the NMEA 2000 network. With a USB link, plug it in and save the plugin settings again.'

/**
 * The `config.ini` the daemon reads, rendered from the plugin's settings.
 * With transport `auto` and a file already present, the file is left alone:
 * the daemon auto-detected it on first run and the user may have edited it.
 * Ports and the API address are always ours, so those keys are rewritten.
 *
 * With `auto` and no file yet, the daemon's own auto-detect would fall back
 * to the only CAN interface, which on a Signal K computer is usually NMEA
 * 2000. On Linux, the only place it can, the file is written here instead:
 * for a USB link if one is plugged in, and otherwise this throws
 * `NO_USB_LINK` and the daemon is not started.
 *
 * A file written here keeps the daemon's `bus_id`, and an existing
 * `cache_dir`, or points it at
 * `cacheDir`: without the key the daemon runs without its schema cache.
 * With `sharedCache` the cache is the one shared with the masterbus tools,
 * and `cache_dir` is always ours.
 */
export function renderConfigIni(
  cfg: BundledConfig,
  existing: string | null,
  cacheDir: string,
  host: Host = HOST,
  sharedCache = false
): string | null {
  const ownKeys = ['listen', 'api_listen', 'api_token', ...(sharedCache ? ['cache_dir'] : [])]
  const marker = '# Managed by the Signal K plugin (signalk-masterbus); edit ports there.'
  const managed = (body: string): string =>
    body
      .split('\n')
      .filter((line) => {
        if (line.trim() === marker) return false
        const key = line.split('=')[0]?.trim().replace(/^#\s*/, '')
        return !(key && ownKeys.includes(key))
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd()
  const ours =
    `\n${marker}\n` +
    (sharedCache ? `cache_dir = ${cacheDir}\n` : '') +
    `listen = 127.0.0.1:${cfg.streamPort}\n` +
    `api_listen = 127.0.0.1:${cfg.apiPort}\n`
  const whole = (transport: 'can' | 'usb', deviceName: string): string => {
    const hb = cfg.heartbeatMaster.trim()
    const cache = sharedCache
      ? null
      : (existing
          ?.split('\n')
          .find((line) => /^\s*cache_dir\s*=/.test(line))
          ?.trim() ?? `cache_dir = ${cacheDir}`)
    // The daemon makes up its own BusID on first run and adds it here; it
    // must survive the file being written again.
    const busId = existing
      ?.split('\n')
      .find((line) => /^\s*bus_id\s*=/.test(line))
      ?.trim()
    return (
      '# masterbus configuration, written by the Signal K plugin (signalk-masterbus).\n' +
      '# Transport, device and master role are edited in the plugin settings.\n' +
      (hb ? `heartbeat_master = ${hb}\n` : '# heartbeat_master = 000001\n') +
      `device_type = ${transport}\n` +
      `device_name = ${deviceName}\n` +
      (cache ? `${cache}\n` : '') +
      (busId ? `${busId}\n` : '') +
      ours
    )
  }
  if (cfg.transport === 'auto') {
    if (existing !== null) return `${managed(existing)}\n${ours}`
    if (host.platform !== 'linux') return null // no CAN fallback: let the daemon detect
    if (!host.usbLink()) throw new Error(NO_USB_LINK)
    return whole('usb', '')
  }
  return whole(cfg.transport, cfg.deviceName.trim())
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
  /** The plugin's data folder: config.ini, the token, and the mapping and
   * cache unless they are shared with the masterbus tools. */
  dataDir: string
  config: BundledConfig
  events: DaemonEvents
  /** Extra arguments, e.g. `['--fake-bus']` in tests. */
  extraArgs?: string[]
  /** How long to wait for READY before giving up, ms. */
  readyTimeoutMs?: number
  /** The machine, for `renderConfigIni`; the real one unless a test says. */
  host?: Host
  /** Where the masterbus tools keep their files; the real ones unless a test says. */
  env?: Env
}

/** Where the daemon's mapping and schema cache are. */
export interface Storage {
  mapping: string
  cache: string
  shared: boolean
}

/**
 * The mapping and cache for these settings: the tools' (or the folder
 * named) when shared, the plugin's data folder otherwise. In a container
 * without a folder named, the plugin's: its home folder isn't kept.
 */
export function storageFor(cfg: BundledConfig, dataDir: string, env: Env = ENV): Storage {
  const named = cfg.sharedDir.trim()
  if (cfg.storage === 'shared' && (named || !inContainer(env))) {
    const dir = named || toolsDir(env)
    return { mapping: path.join(dir, 'mapping.json'), cache: toolsCacheDir(dir, env), shared: true }
  }
  return {
    mapping: path.join(dataDir, 'mapping.json'),
    cache: path.join(dataDir, 'cache'),
    shared: false
  }
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
  private storage: Storage | null = null
  private moved: string | null = null

  constructor(opts: DaemonOptions) {
    this.opts = opts
    this.token = randomBytes(24).toString('hex')
  }

  /** The last lines the daemon wrote to stderr, for an error status. */
  get recentLog(): string[] {
    return [...this.recent]
  }

  /** The mapping file the daemon reads and the editor writes. */
  get mappingPath(): string | null {
    return this.storage?.mapping ?? null
  }

  /** What became of the plugin's own mapping when sharing began, if anything. */
  get notice(): string | null {
    return this.moved
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
    const storage = storageFor(this.opts.config, this.opts.dataDir, this.opts.env)
    this.storage = storage
    const rendered = renderConfigIni(
      this.opts.config,
      existing,
      storage.cache,
      this.opts.host,
      storage.shared
    )
    if (storage.shared) {
      this.moved = adoptMapping(path.join(this.opts.dataDir, 'mapping.json'), storage.mapping)
    }
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
        env: {
          ...process.env,
          RUST_LOG: process.env.RUST_LOG ?? 'warn',
          // The daemon reads its mapping from here instead of beside config.ini.
          ...(this.storage?.shared ? { MAPPING: this.storage.mapping } : {})
        }
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
