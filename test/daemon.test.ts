import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULTS } from '../src/config.js'
import { DaemonManager, platformPackage, renderConfigIni, resolveBinary } from '../src/daemon.js'

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

describe('renderConfigIni', () => {
  it('leaves an auto-detected file to the daemon, then only manages its own keys', () => {
    const cfg = { ...DEFAULTS.bundled }
    expect(renderConfigIni(cfg, null)).toBeNull()
    const existing =
      'device_type = can\ndevice_name = can0\nlisten = 0.0.0.0:3009\n# api_listen = x\n'
    const out = renderConfigIni(cfg, existing)
    expect(out).toContain('device_type = can')
    expect(out).toContain('device_name = can0')
    expect(out).not.toContain('0.0.0.0:3009')
    expect(out).toContain('listen = 127.0.0.1:3009')
    expect(out).toContain('api_listen = 127.0.0.1:3010')
    expect(out).not.toContain('api_token')
  })

  it('writes the whole file when the transport is explicit', () => {
    const cfg = {
      ...DEFAULTS.bundled,
      transport: 'usb' as const,
      heartbeatMaster: '000001',
      apiPort: 4010,
      streamPort: 4009
    }
    const out = renderConfigIni(cfg, 'device_type = can\n')
    expect(out).toContain('device_type = usb')
    expect(out).toContain('heartbeat_master = 000001')
    expect(out).toContain('device_name = \n')
    expect(out).toContain('api_listen = 127.0.0.1:4010')
    expect(out).toContain('listen = 127.0.0.1:4009')
    expect(out).not.toContain('device_type = can')
  })
})

describe('resolveBinary', () => {
  it('prefers a configured path and explains a missing package', () => {
    const dir = tmp()
    const bin = fakeDaemon(dir, 'exit 0')
    expect(resolveBinary(bin)).toBe(bin)
    expect(() => resolveBinary(path.join(dir, 'nope'))).toThrow('does not exist')
    expect(() => resolveBinary('')).toThrow(platformPackage())
    expect(platformPackage('linux', 'arm64')).toBe('signalk-masterbus-daemon-linux-arm64')
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
      config: { ...DEFAULTS.bundled, transport: 'usb' },
      events: ev,
      extraArgs: ['--fake-bus']
    })
    await m.start()
    expect(m.running).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'state', 'api-token'), 'utf8')).toBe(m.token)
    expect(fs.readFileSync(path.join(dir, 'state', 'config.ini'), 'utf8')).toContain(
      'device_type = usb'
    )
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

  it('rejects when the daemon exits before READY', async () => {
    const dir = tmp()
    const bin = fakeDaemon(dir, 'echo "connect failed: no bus" >&2\nexit 2')
    const ev = events()
    const m = new DaemonManager({
      binary: bin,
      dataDir: path.join(dir, 'state'),
      config: DEFAULTS.bundled,
      events: ev
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
      config: DEFAULTS.bundled,
      events: ev
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
