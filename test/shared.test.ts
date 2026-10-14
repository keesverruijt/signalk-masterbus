import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULTS } from '../src/config.js'
import { storageFor } from '../src/daemon.js'
import {
  adoptMapping,
  BACKUP,
  inContainer,
  toolsCacheDir,
  toolsDir,
  type Env
} from '../src/shared.js'

const dirs: string[] = []
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'skmb-shared-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

/** A machine with these files and folders, and nothing else. */
function env(over: Partial<Env> = {}, files: string[] = [], folders: string[] = []): Env {
  return {
    platform: 'linux',
    home: '/home/pi',
    vars: {},
    isFile: (p) => files.includes(p),
    isDir: (p) => folders.includes(p),
    ...over
  }
}

describe('toolsDir', () => {
  it('finds the folder the masterbus tools use', () => {
    expect(toolsDir(env())).toBe('/home/pi/.config/masterbus')
    expect(toolsDir(env({ vars: { XDG_CONFIG_HOME: '/xdg' } }))).toBe('/xdg/masterbus')
    expect(toolsDir(env({}, ['/etc/default/masterbus/config.ini']))).toBe('/etc/default/masterbus')
    expect(toolsDir(env({ vars: { MASTERBUS_CONFIG_DIR: '/pinned' } }))).toBe('/pinned')
    expect(toolsDir(env({ platform: 'darwin', home: '/Users/k' }))).toBe(
      '/Users/k/Library/Application Support/masterbus'
    )
  })
})

describe('toolsCacheDir', () => {
  it("uses the tools' cache_dir when that folder is here, else their default", () => {
    const dir = tmp()
    expect(toolsCacheDir(dir, env())).toBe('/home/pi/.cache/masterbus')
    fs.writeFileSync(path.join(dir, 'config.ini'), 'cache_dir = /srv/cache\n')
    expect(toolsCacheDir(dir, env({}, [], ['/srv/cache']))).toBe('/srv/cache')
    // A path from another machine (the host, seen from a container) is not used.
    expect(toolsCacheDir(dir, env())).toBe('/home/pi/.cache/masterbus')
    expect(toolsCacheDir('/etc/default/masterbus', env())).toBe('/var/lib/masterbus')
  })
})

describe('storageFor', () => {
  const plugin = '/sk/plugin-config-data/signalk-masterbus/masterbus'

  it("shares the tools' mapping and cache by default", () => {
    expect(storageFor(DEFAULTS.bundled, plugin, env())).toEqual({
      mapping: '/home/pi/.config/masterbus/mapping.json',
      cache: '/home/pi/.cache/masterbus',
      shared: true
    })
  })

  it("keeps the plugin's own in a container unless a folder is named", () => {
    const container = env({}, ['/.dockerenv'])
    expect(inContainer(container)).toBe(true)
    expect(storageFor(DEFAULTS.bundled, plugin, container)).toEqual({
      mapping: `${plugin}/mapping.json`,
      cache: `${plugin}/cache`,
      shared: false
    })
    const named = { ...DEFAULTS.bundled, sharedDir: '/host/masterbus' }
    expect(storageFor(named, plugin, container).mapping).toBe('/host/masterbus/mapping.json')
  })

  it("keeps the plugin's own when told to", () => {
    const own = { ...DEFAULTS.bundled, storage: 'plugin' as const }
    expect(storageFor(own, plugin, env()).shared).toBe(false)
  })
})

describe('adoptMapping', () => {
  it('moves the plugin mapping when the tools have none', () => {
    const dir = tmp()
    const own = path.join(dir, 'plugin', 'mapping.json')
    const shared = path.join(dir, 'tools', 'mapping.json')
    fs.mkdirSync(path.dirname(own))
    fs.writeFileSync(own, 'A')
    expect(adoptMapping(own, shared)).toContain(shared)
    expect(fs.readFileSync(shared, 'utf8')).toBe('A')
    expect(fs.existsSync(own)).toBe(false)
    expect(adoptMapping(own, shared)).toBeNull()
  })

  it("keeps a different plugin mapping as a backup, and the tools' in use", () => {
    const dir = tmp()
    const own = path.join(dir, 'mapping-own.json')
    const shared = path.join(dir, 'tools', 'mapping.json')
    fs.mkdirSync(path.dirname(shared))
    fs.writeFileSync(shared, 'TOOLS')
    fs.writeFileSync(path.join(dir, 'tools', BACKUP), 'OLDER')
    fs.writeFileSync(own, 'PLUGIN')
    const note = adoptMapping(own, shared)
    const backup = path.join(dir, 'tools', 'mapping.plugin-backup-2.json')
    expect(note).toContain(backup)
    expect(fs.readFileSync(shared, 'utf8')).toBe('TOOLS')
    expect(fs.readFileSync(backup, 'utf8')).toBe('PLUGIN')
    expect(fs.readFileSync(path.join(dir, 'tools', BACKUP), 'utf8')).toBe('OLDER')
    expect(fs.existsSync(own)).toBe(false)
  })

  it('drops a plugin mapping that is the same as the shared one', () => {
    const dir = tmp()
    const own = path.join(dir, 'own.json')
    const shared = path.join(dir, 'tools', 'mapping.json')
    fs.mkdirSync(path.dirname(shared))
    fs.writeFileSync(shared, 'SAME')
    fs.writeFileSync(own, 'SAME')
    expect(adoptMapping(own, shared)).not.toContain('backup')
    expect(fs.readdirSync(path.join(dir, 'tools'))).toEqual(['mapping.json'])
  })
})
