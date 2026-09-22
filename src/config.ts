/**
 * The plugin's configuration: the JSON Schema the admin UI renders, the
 * matching TypeScript type, and the defaults.
 *
 * Signal K does not seed schema defaults into the runtime config: when the
 * plugin is enabled without the form being saved, `start()` receives `{}`.
 * `withDefaults` fills the gaps so the rest of the plugin can rely on every
 * field being present.
 */

export type Mode = 'bundled' | 'external'
export type Transport = 'auto' | 'can' | 'usb'

export interface BundledConfig {
  /** `auto` lets the daemon detect a USB link or the lone CAN interface. */
  transport: Transport
  /** CAN interface name, or USB-link serial (blank = first). */
  deviceName: string
  /** 24-bit hex id to announce as bus master, or blank to stay passive. */
  heartbeatMaster: string
  apiPort: number
  streamPort: number
  /** A `masterbus-signalk` binary to run instead of the bundled one. */
  binaryPath: string
}

export interface ExternalConfig {
  host: string
  apiPort: number
  streamPort: number
  token: string
}

export interface Config {
  mode: Mode
  bundled: BundledConfig
  external: ExternalConfig
  /** Mastervolt installer code, for writes to fields that need a login. */
  installerCode: number | null
}

export const DEFAULTS: Config = {
  mode: 'bundled',
  bundled: {
    transport: 'auto',
    deviceName: '',
    heartbeatMaster: '',
    apiPort: 3010,
    streamPort: 3009,
    binaryPath: ''
  },
  external: {
    host: 'localhost',
    apiPort: 3010,
    streamPort: 3009,
    token: ''
  },
  installerCode: null
}

/** The configuration with every missing field filled from `DEFAULTS`. */
export function withDefaults(config: unknown): Config {
  const c = (config ?? {}) as Partial<Config>
  return {
    mode: c.mode === 'external' ? 'external' : 'bundled',
    bundled: { ...DEFAULTS.bundled, ...(c.bundled ?? {}) },
    external: { ...DEFAULTS.external, ...(c.external ?? {}) },
    installerCode:
      typeof c.installerCode === 'number' && Number.isFinite(c.installerCode)
        ? c.installerCode
        : null
  }
}

export const SCHEMA = {
  type: 'object',
  properties: {
    mode: {
      type: 'string',
      title: 'Where the MasterBus daemon runs',
      description:
        'Bundled: this plugin starts masterbus-signalk on this machine, which must be the one ' +
        'wired to the bus (CAN adapter or Mastervolt USB link). External: connect to a ' +
        'masterbus-signalk already running elsewhere, with its API enabled.',
      enum: ['bundled', 'external'],
      enumNames: ['Bundled (run it here)', 'External (connect to one)'],
      default: 'bundled'
    },
    bundled: {
      type: 'object',
      title: 'Bundled daemon',
      properties: {
        transport: {
          type: 'string',
          title: 'Transport',
          description:
            'Auto picks a plugged-in Mastervolt USB link, else the only CAN interface. Set it ' +
            'explicitly when the machine has several.',
          enum: ['auto', 'can', 'usb'],
          enumNames: ['Auto-detect', 'SocketCAN (Linux)', 'Mastervolt USB link'],
          default: 'auto'
        },
        deviceName: {
          type: 'string',
          title: 'Device',
          description: 'CAN interface (e.g. can0), or the USB link serial number (blank = first).',
          default: ''
        },
        heartbeatMaster: {
          type: 'string',
          title: 'Act as bus master (hex id)',
          description:
            'A 24-bit hex id, e.g. 000001, makes the daemon send master heartbeats so devices ' +
            'stay responsive on a bus without an EasyView or other master. Leave blank to stay ' +
            'passive.',
          default: ''
        },
        apiPort: {
          type: 'integer',
          title: 'API port (loopback)',
          default: 3010,
          minimum: 1,
          maximum: 65535
        },
        streamPort: {
          type: 'integer',
          title: 'Stream port (loopback)',
          default: 3009,
          minimum: 1,
          maximum: 65535
        },
        binaryPath: {
          type: 'string',
          title: 'masterbus-signalk binary (advanced)',
          description:
            'Leave blank to use the binary bundled with this plugin. A path here runs that ' +
            'instead, e.g. a development build.',
          default: ''
        }
      }
    },
    external: {
      type: 'object',
      title: 'External daemon',
      properties: {
        host: { type: 'string', title: 'Host', default: 'localhost' },
        apiPort: {
          type: 'integer',
          title: 'API port',
          default: 3010,
          minimum: 1,
          maximum: 65535
        },
        streamPort: {
          type: 'integer',
          title: 'Stream port',
          default: 3009,
          minimum: 1,
          maximum: 65535
        },
        token: {
          type: 'string',
          title: 'API token',
          description: "The daemon's api_token from its config.ini.",
          default: ''
        }
      }
    },
    installerCode: {
      type: ['number', 'null'],
      title: 'Installer code',
      description:
        'The Mastervolt installer access code. Only needed for writes to fields that are ' +
        'read-only at user level; leave blank otherwise.',
      default: null
    }
  }
}

// The installer code is a number, and the form has no password widget for
// numbers ("No widget 'password' for type 'number'" takes the whole page
// down), so only the token is masked.
export const UI_SCHEMA = {
  external: { token: { 'ui:widget': 'password' } }
}
