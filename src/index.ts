import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Plugin, PluginRouter, ServerAPI } from '@signalk/server-api'

import { DaemonClient, type Endpoint } from './client.js'
import { SCHEMA, UI_SCHEMA, withDefaults, type Config } from './config.js'
import { DaemonManager, errMsg, resolveBinary } from './daemon.js'
import { PutBridge } from './put-bridge.js'
import { registerRoutes } from './router.js'
import { StreamForwarder } from './stream-forwarder.js'
import type { Mapping, Status } from './types.js'

export const PLUGIN_ID = 'signalk-masterbus'

/** This plugin's own version and the masterbus version it bundles. */
export const VERSIONS: { plugin: string; daemon: string } = (() => {
  try {
    const own = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const pkg = JSON.parse(fs.readFileSync(own, 'utf8')) as {
      version?: string
      masterbusDaemon?: string
    }
    return { plugin: pkg.version ?? '?', daemon: pkg.masterbusDaemon ?? '?' }
  } catch {
    return { plugin: '?', daemon: '?' }
  }
})()

/** How often the daemon is asked for its status and the mapping re-synced. */
const POLL_MS = 10_000

/**
 * Mastervolt MasterBus for Signal K.
 *
 * The plugin is a thin layer over `masterbus-signalk`, the daemon from the
 * masterbus project. In *bundled* mode the plugin starts the daemon on this
 * machine and keeps its config, mapping and schema cache under the plugin's
 * data directory; in *external* mode it connects to one running elsewhere.
 * Either way it speaks the same two things to it: the delta stream, which is
 * republished through `handleMessage`, and the control API, which the
 * mapping editor (the webapp under `public/`) reaches through this plugin's
 * router and which turns Signal K PUTs into field writes.
 */
export default function plugin(app: ServerAPI): Plugin {
  let config: Config | null = null
  let daemon: DaemonManager | null = null
  let client: DaemonClient | null = null
  let forwarder: StreamForwarder | null = null
  let bridge: PutBridge | null = null
  let poller: ReturnType<typeof setInterval> | null = null
  let lastStatus: Status | null = null
  let lastError: string | null = null
  let mappingSeen = ''
  // Bumped on every start/stop so a start still in flight when stop() runs
  // notices and does not resurrect anything.
  let generation = 0

  const summary = (): Record<string, unknown> => ({
    versions: VERSIONS,
    mode: config?.mode ?? null,
    connected: client !== null && lastStatus !== null,
    daemon: daemon ? { running: daemon.running, recentLog: daemon.recentLog } : null,
    status: lastStatus,
    error: lastError,
    stream: forwarder ? { connected: forwarder.connected, ...forwarder.counts } : null,
    putPaths: bridge?.paths ?? []
  })

  const statusLine = (s: Status): string => {
    const where =
      config?.mode === 'bundled'
        ? `Bundled daemon ${s.version}`
        : `Daemon ${s.version} at ${client?.endpoint.host}`
    const problems =
      s.diagnostics.errors > 0
        ? `; ${s.diagnostics.errors} mapping entr${s.diagnostics.errors === 1 ? 'y' : 'ies'} skipped, see the editor`
        : ''
    return (
      `${where}: streaming ${s.streaming} field${s.streaming === 1 ? '' : 's'} from ` +
      `${s.mapped.devices} of ${s.devices} device${s.devices === 1 ? '' : 's'}` +
      (s.devices === 0 ? ' (discovering)' : '') +
      problems
    )
  }

  const setError = (msg: string): void => {
    lastError = msg
    app.setPluginError(msg)
  }

  /** Ask the daemon how it is doing and keep the PUT handlers in step. */
  const poll = async (): Promise<void> => {
    if (!client || !bridge) return
    try {
      const status = await client.status()
      lastStatus = status
      lastError = null
      const mapping: Mapping = await client.mapping()
      const putKey = JSON.stringify(
        Object.entries(mapping.devices).map(([s, d]) => [
          s,
          Object.entries(d.fields)
            .filter(([, f]) => f.put)
            .map(([k, f]) => [k, f.path])
        ])
      )
      if (putKey !== mappingSeen) {
        mappingSeen = putKey
        const { added, removed } = bridge.sync(mapping)
        if (added.length + removed.length > 0) {
          app.debug(`PUT targets: +${added.length} -${removed.length}: ${bridge.paths.join(' ')}`)
        }
      }
      app.setPluginStatus(statusLine(status))
    } catch (err) {
      lastStatus = null
      setError(`Daemon: ${errMsg(err)}`)
    }
  }

  const asyncStart = async (cfg: Config, gen: number): Promise<void> => {
    let endpoint: Endpoint
    if (cfg.mode === 'bundled') {
      const binary = resolveBinary(cfg.bundled.binaryPath)
      const dataDir = path.join(app.getDataDirPath(), 'masterbus')
      const d = new DaemonManager({
        binary,
        dataDir,
        config: cfg.bundled,
        events: {
          log: (line) => {
            app.debug(`daemon: ${line}`)
          },
          exited: (code, signal, restartIn) => {
            const why = `the daemon exited (${code ?? signal ?? '?'})`
            if (restartIn === null) {
              app.debug(why)
            } else {
              setError(
                `${why}; restarting in ${restartIn / 1000} s. ${d.recentLog.slice(-3).join(' | ')}`
              )
            }
          },
          ready: () => {
            app.setPluginStatus('Daemon restarted; reconnecting')
            void poll()
          }
        }
      })
      daemon = d
      app.setPluginStatus(`Starting ${path.basename(binary)}…`)
      await d.start()
      if (gen !== generation) {
        await d.stop()
        return
      }
      endpoint = {
        host: '127.0.0.1',
        apiPort: cfg.bundled.apiPort,
        streamPort: cfg.bundled.streamPort,
        token: d.token
      }
    } else {
      endpoint = { ...cfg.external }
      app.setPluginStatus(`Connecting to ${endpoint.host}:${endpoint.apiPort}…`)
    }
    const c = new DaemonClient(endpoint)
    // A version check before anything else; a wrong daemon is refused loudly.
    lastStatus = await c.status()
    if (gen !== generation) return
    client = c
    const b = new PutBridge(app, c, PLUGIN_ID)
    b.setInstallerCode(cfg.installerCode)
    bridge = b
    const f = new StreamForwarder(app, {
      pluginId: PLUGIN_ID,
      host: endpoint.host,
      port: endpoint.streamPort,
      debug: (m) => {
        app.debug(m)
      }
    })
    forwarder = f
    f.start()
    await poll()
    poller = setInterval(() => {
      void poll()
    }, POLL_MS)
  }

  return {
    id: PLUGIN_ID,
    name: 'MasterBus',
    description:
      'Mastervolt MasterBus: publish battery, charger and inverter values, edit the mapping ' +
      `in the browser, and switch devices from Signal K. Bundles masterbus-signalk ${VERSIONS.daemon}.`,
    schema: SCHEMA,
    uiSchema: UI_SCHEMA,

    start(options: object) {
      const gen = ++generation
      config = withDefaults(options)
      lastError = null
      void asyncStart(config, gen).catch((err: unknown) => {
        if (gen !== generation) return
        setError(errMsg(err))
      })
    },

    async stop() {
      generation++
      if (poller) {
        clearInterval(poller)
        poller = null
      }
      forwarder?.stop()
      forwarder = null
      bridge?.clear()
      bridge = null
      client = null
      lastStatus = null
      if (daemon) {
        const d = daemon
        daemon = null
        await d.stop()
      }
      app.setPluginStatus('Stopped')
    },

    registerWithRouter(router: PluginRouter) {
      registerRoutes(router, { client: () => client, summary })
    }
  }
}
