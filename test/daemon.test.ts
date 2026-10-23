import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULTS } from '../src/config.js'
import {
  DaemonManager,
  NO_USB_LINK,
  platformDir,
  renderConfigIni,
  resolveBinary,
  usbLinkPresent
} from '../src/daemon.js'
import type { Env } from '../src/shared.js'

const dirs: string[] = []
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'skmb-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

/** A stand-in daemon: a shell script that behaves as told. */
function fakeDaemon(dir: string, body: string): string {
  const p = path.join(dir, 'fake-daemon.sh')
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return p
}

const events = () => ({ log: vi.fn(), exited: vi.fn(), ready: vi.fn() })

const linux = (usbLink: boolean) => ({ platform: 'linux', usbLink: () => usbLink })

/** A Linux machine whose home folder is `home`; nothing outside it exists. */
function fakeEnv(home: string): Env {
  const inside = (p: string) => p.startsWith(home)
  return {
    platform: 'linux',
    home,
    vars: {},
    isFile: (p) => inside(p) && fs.existsSync(p) && fs.statSync(p).isFile(),
    isDir: (p) => inside(p) && fs.existsSync(p) && fs.statSync(p).isDirectory()
  }
}
const CACHE = '/data/masterbus/cache'
/** Mapping and cache in the plugin's data folder: tests never touch the real home folder. */
const PLUGIN = { ...DEFAULTS.bundled, storage: 'plugin' as const }

describe('renderConfigIni', () => {
  it('leaves an existing auto-detected file alone, apart from its own keys', () => {
    const cfg = { ...DEFAULTS.bundled }
    const existing =
      'device_type = can\ndevice_name = can0\nlisten = 0.0.0.0:3009\n# api_listen = x\n'
    const out = renderConfigIni(cfg, existing, CACHE, linux(false))
    expect(out).toContain('device_type = can')
    expect(out).toContain('device_name = can0')
    expect(out).not.toContain('0.0.0.0:3009')
    expect(out).toContain('listen = 127.0.0.1:3009')
    expect(out).toContain('api_listen = 127.0.0.1:3010')
    expect(out).not.toContain('api_token')
    expect(out).not.toContain('cache_dir')
  })

  it('does not pile up its own comment line over restarts', () => {
    const cfg = { ...DEFAULTS.bundled }
    let ini: string | null = 'device_type = can\ndevice_name = can0\n'
    for (let i = 0; i < 3; i++) ini = renderConfigIni(cfg, ini, CACHE, linux(false))
    expect(ini?.match(/# Managed by/g)).toHaveLength(1)
  })

  it('on first start, auto-detect picks a USB link and never a CAN interface', () => {
    const cfg = { ...DEFAULTS.bundled }
    const out = renderConfigIni(cfg, null, CACHE, linux(true))
    expect(out).toContain('device_type = usb')
    expect(out).toContain('device_name = \n')
    expect(out).toContain(`cache_dir = ${CACHE}`)
    expect(() => renderConfigIni(cfg, null, CACHE, linux(false))).toThrow(NO_USB_LINK)
    // Elsewhere there is no CAN to fall back to, so the daemon detects.
    expect(
      renderConfigIni(cfg, null, CACHE, { platform: 'darwin', usbLink: () => false })
    ).toBeNull()
  })

  it('writes the whole file when the transport is explicit', () => {
    const cfg = {
      ...DEFAULTS.bundled,
      transport: 'usb' as const,
      heartbeatMaster: '000001',
      apiPort: 4010,
      streamPort: 4009
    }
    const out = renderConfigIni(cfg, 'device_type = can\n', CACHE, linux(false))
    expect(out).toContain('device_type = usb')
    expect(out).toContain('heartbeat_master = 000001')
    expect(out).toContain('device_name = \n')
    expect(out).toContain('api_listen = 127.0.0.1:4010')
    expect(out).toContain('listen = 127.0.0.1:4009')
    expect(out).not.toContain('device_type = can')
  })

  it('keeps the schema cache on with an explicit transport', () => {
    const cfg = { ...DEFAULTS.bundled, transport: 'can' as const, deviceName: 'can1' }
    expect(renderConfigIni(cfg, null, CACHE)).toContain(`cache_dir = ${CACHE}`)
    const out = renderConfigIni(cfg, 'device_type = usb\ncache_dir = /var/cache/mb\n', CACHE)
    expect(out).toContain('cache_dir = /var/cache/mb')
    expect(out).not.toContain(CACHE)
  })

  it("keeps the daemon's bus_id when the file is written again", () => {
    const cfg = { ...DEFAULTS.bundled, transport: 'can' as const, deviceName: 'can1' }
    const out = renderConfigIni(cfg, 'device_type = usb\nbus_id = 1C02A4F7\n', CACHE)
    expect(out).toContain('bus_id = 1C02A4F7')
    expect(renderConfigIni(cfg, null, CACHE)).not.toContain('bus_id')
  })
})

describe('usbLinkPresent', () => {
  it('points the cache at the shared one, whatever the file said', () => {
    const shared = '/home/pi/.cache/masterbus'
    const existing = 'device_type = usb\ncache_dir = /data/masterbus/cache\n'
    for (const transport of ['auto', 'usb'] as const) {
      const out = renderConfigIni(
        { ...DEFAULTS.bundled, transport },
        existing,
        shared,
        linux(true),
        true
      )
      expect(out?.match(/^cache_dir = .*$/gm)).toEqual([`cache_dir = ${shared}`])
    }
  })

  it('finds a device with the Mastervolt USB vendor id in sysfs', () => {
    const root = tmp()
    expect(usbLinkPresent(path.join(root, 'missing'))).toBe(false)
    fs.mkdirSync(path.join(root, '1-1'))
    fs.writeFileSync(path.join(root, '1-1', 'idVendor'), '0bda\n')
    fs.mkdirSync(path.join(root, 'usb1'))
    expect(usbLinkPresent(root)).toBe(false)
    fs.mkdirSync(path.join(root, '1-2'))
    fs.writeFileSync(path.join(root, '1-2', 'idVendor'), '1a64\n')
    expect(usbLinkPresent(root)).toBe(true)
  })
})

describe('resolveBinary', () => {
  it('prefers a configured path, else the bundled binary under bin/', () => {
    const dir = tmp()
    const bin = fakeDaemon(dir, 'exit 0')
    expect(resolveBinary(bin)).toBe(bin)
    expect(() => resolveBinary(path.join(dir, 'nope'))).toThrow('does not exist')
    // Resolved relative to the plugin's compiled code: <root>/plugin/daemon.js
    // looks in <root>/bin/<os>-<arch>/.
    const from = `file://${path.join(dir, 'plugin', 'daemon.js')}`
    expect(() => resolveBinary('', from)).toThrow(`bin/${platformDir()}`)
    const bundled = path.join(dir, 'bin', platformDir())
    fs.mkdirSync(bundled, { recursive: true })
    const exe = process.platform === 'win32' ? 'masterbus-signalk.exe' : 'masterbus-signalk'
    fs.writeFileSync(path.join(bundled, exe), '')
    expect(resolveBinary('', from)).toBe(path.join(bundled, exe))
    expect(platformDir('linux', 'arm64')).toBe('linux-arm64')
  })
})

describe('DaemonManager', () => {
  it('writes config and token, spawns with --config-dir, and resolves on READY', async () => {
    const dir = tmp()
    const bin = fakeDaemon(
      dir,
      'echo "args: $*" >&2\necho \'READY {"api":"127.0.0.1:3010"}\'\nwhile :; do sleep 1; done'
    )
    const ev = events()
    const m = new DaemonManager({
      binary: bin,
      dataDir: path.join(dir, 'state'),
      config: { ...PLUGIN, transport: 'usb' },
      events: ev,
      extraArgs: ['--fake-bus']
    })
    await m.start()
    expect(m.running).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'state', 'api-token'), 'utf8')).toBe(m.token)
    const ini = fs.readFileSync(path.join(dir, 'state', 'config.ini'), 'utf8')
    expect(ini).toContain('device_type = usb')
    expect(ini).toContain(`cache_dir = ${path.join(dir, 'state', 'cache')}`)
    await vi.waitFor(() => {
      expect(ev.log).toHaveBeenCalled()
    })
    const args = (ev.log.mock.calls[0] as [string])[0]
    expect(args).toContain(`--config-dir ${path.join(dir, 'state')}`)
    expect(args).toContain('--api 127.0.0.1:3010')
    expect(args).toContain('--stream 127.0.0.1:3009')
    expect(args).toContain('--api-token-file')
    expect(args).toContain('--fake-bus')
    await m.stop()
    expect(m.running).toBe(false)
    expect(ev.exited).toHaveBeenCalledWith(null, 'SIGTERM', null)
  })

  it('shares the mapping with the masterbus tools and hands it to the daemon', async () => {
    const dir = tmp()
    const home = path.join(dir, 'home')
    const state = path.join(dir, 'state')
    fs.mkdirSync(state, { recursive: true })
    fs.writeFileSync(path.join(state, 'mapping.json'), '{"version":1,"devices":{}}')
    const bin = fakeDaemon(
      dir,
      'echo "mapping: $MAPPING" >&2\necho READY\nwhile :; do sleep 1; done'
    )
    const ev = events()
    const m = new DaemonManager({
      binary: bin,
      dataDir: state,
      config: { ...DEFAULTS.bundled, transport: 'usb' },
      events: ev,
      env: fakeEnv(home)
    })
    await m.start()
    const shared = path.join(home, '.config', 'masterbus', 'mapping.json')
    expect(m.mappingPath).toBe(shared)
    expect(fs.readFileSync(shared, 'utf8')).toBe('{"version":1,"devices":{}}')
    expect(fs.existsSync(path.join(state, 'mapping.json'))).toBe(false)
    expect(m.notice).toContain(shared)
    const ini = fs.readFileSync(path.join(state, 'config.ini'), 'utf8')
    expect(ini).toContain(`cache_dir = ${path.join(home, '.cache', 'masterbus')}`)
    await vi.waitFor(() => {
      expect(ev.log).toHaveBeenCalledWith(`mapping: ${shared}`)
    })
    await m.stop()
  })

  it('does not start the daemon when auto-detect finds no USB link', async () => {
    const dir = tmp()
    const marker = path.join(dir, 'started')
    const bin = fakeDaemon(dir, `touch ${marker}\necho READY\nwhile :; do sleep 1; done`)
    const m = new DaemonManager({
      binary: bin,
      dataDir: path.join(dir, 'state'),
      config: PLUGIN,
      events: events(),
      host: linux(false)
    })
    await expect(m.start()).rejects.toThrow(NO_USB_LINK)
    expect(m.running).toBe(false)
    expect(fs.existsSync(marker)).toBe(false)
    expect(fs.existsSync(path.join(dir, 'state', 'config.ini'))).toBe(false)
  })

  it('rejects when the daemon exits before READY', async () => {
    const dir = tmp()
    const bin = fakeDaemon(dir, 'echo "connect failed: no bus" >&2\nexit 2')
    const ev = events()
    const m = new DaemonManager({
      binary: bin,
      dataDir: path.join(dir, 'state'),
      config: PLUGIN,
      events: ev,
      host: linux(true)
    })
    await expect(m.start()).rejects.toThrow('exited with 2 before READY')
    expect(m.recentLog).toEqual(['connect failed: no bus'])
    await m.stop()
  })

  it('restarts with backoff after a crash, and not after stop()', async () => {
    const dir = tmp()
    // Ready, then die after a moment. Every run does the same.
    const bin = fakeDaemon(dir, 'echo READY\nsleep 0.1\nexit 1')
    const ev = events()
    const m = new DaemonManager({
      binary: bin,
      dataDir: path.join(dir, 'state'),
      config: PLUGIN,
      events: ev,
      host: linux(true)
    })
    await m.start()
    await vi.waitFor(() => {
      expect(ev.exited).toHaveBeenCalledWith(1, null, 1000)
    })
    expect(m.running).toBe(false)
    await m.stop()
    // No restart after stop, however long we wait past the backoff.
    await new Promise((r) => setTimeout(r, 1200))
    expect(ev.ready).not.toHaveBeenCalled()
    expect(ev.exited).toHaveBeenCalledTimes(1)
  })
})
