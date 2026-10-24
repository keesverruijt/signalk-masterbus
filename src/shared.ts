/**
 * The mapping and schema cache the plugin shares with the masterbus tools
 * (`masterbus-tui`, `masterbus-dump`, a `masterbus-signalk` run by hand).
 *
 * With one mapping on the machine, an edit in the TUI reaches Signal K (the
 * daemon reloads `mapping.json` when it changes) and an edit in the web
 * editor is what the TUI shows next time. Before, the bundled daemon kept a
 * mapping of its own, and the two drifted apart without anyone noticing.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** What the folder lookup needs to know about the machine. */
export interface Env {
  platform: string
  home: string
  vars: Record<string, string | undefined>
  isFile: (p: string) => boolean
  isDir: (p: string) => boolean
}

export const ENV: Env = {
  platform: process.platform,
  home: os.homedir(),
  vars: process.env,
  isFile: (p) => {
    try {
      return fs.statSync(p).isFile()
    } catch {
      return false
    }
  },
  isDir: (p) => {
    try {
      return fs.statSync(p).isDirectory()
    } catch {
      return false
    }
  }
}

/**
 * The folder holding the tools' `config.ini` and `mapping.json`, by the
 * tools' own rule: `$MASTERBUS_CONFIG_DIR`; on Linux the system folder when
 * it has a `config.ini`; otherwise the per-user configuration folder.
 */
export function toolsDir(env: Env = ENV): string {
  const pinned = env.vars.MASTERBUS_CONFIG_DIR?.trim()
  if (pinned) return pinned
  switch (env.platform) {
    case 'linux': {
      if (env.isFile('/etc/default/masterbus/config.ini')) return '/etc/default/masterbus'
      const xdg = env.vars.XDG_CONFIG_HOME?.trim()
      return path.join(xdg || path.join(env.home, '.config'), 'masterbus')
    }
    case 'darwin':
      return path.join(env.home, 'Library', 'Application Support', 'masterbus')
    case 'win32':
      return path.join(env.vars.APPDATA ?? path.join(env.home, 'AppData', 'Roaming'), 'masterbus')
    default:
      return path.join(env.home, '.config', 'masterbus')
  }
}

/**
 * The tools' schema cache for the folder `dir`: the `cache_dir` in its
 * `config.ini` when that folder exists here, else the tools' default.
 */
export function toolsCacheDir(dir: string, env: Env = ENV): string {
  let ini = ''
  try {
    ini = fs.readFileSync(path.join(dir, 'config.ini'), 'utf8')
  } catch {
    // No config.ini: the default below.
  }
  const set = /^\s*cache_dir\s*=\s*(.+?)\s*$/m.exec(ini)?.[1]
  if (set && env.isDir(set)) return set
  if (env.vars.MASTERBUS_CONFIG_DIR?.trim()) return path.join(dir, 'cache')
  if (dir.startsWith('/etc/')) return '/var/lib/masterbus'
  switch (env.platform) {
    case 'linux': {
      const xdg = env.vars.XDG_CACHE_HOME?.trim()
      return path.join(xdg || path.join(env.home, '.cache'), 'masterbus')
    }
    case 'darwin':
      return path.join(env.home, 'Library', 'Caches', 'masterbus')
    case 'win32':
      return path.join(
        env.vars.LOCALAPPDATA ?? path.join(env.home, 'AppData', 'Local'),
        'masterbus',
        'cache'
      )
    default:
      return path.join(dir, 'cache')
  }
}

/**
 * Whether Signal K runs in a container (Docker or Podman). The home folder
 * there is usually not kept when the container is recreated, so a shared
 * folder has to be named, one that is mounted from the host.
 */
export function inContainer(env: Env = ENV): boolean {
  return env.isFile('/.dockerenv') || env.isFile('/run/.containerenv')
}

export const BACKUP = 'mapping.plugin-backup.json'

/** Whether `a` and `b` are one file, through a symlink or a hard link. */
function sameFile(a: string, b: string): boolean {
  try {
    const [x, y] = [fs.statSync(a), fs.statSync(b)]
    return x.dev === y.dev && x.ino === y.ino
  } catch {
    return false
  }
}

/**
 * Move the mapping the plugin kept for itself (`own`) to the shared one
 * (`shared`). Without a shared mapping it simply moves there; with the same
 * one, the plugin's copy goes. With a different one, the shared mapping wins
 * and the plugin's is kept beside it as `mapping.plugin-backup.json`
 * (numbered if that name is taken), so nobody's work is lost. When the two
 * are one file (a tools folder linked to the plugin's, #3), it stays put.
 * Returns a sentence for the plugin status, or null when there was nothing to
 * move.
 */
export function adoptMapping(own: string, shared: string): string | null {
  if (!fs.existsSync(own) || sameFile(own, shared)) return null
  fs.mkdirSync(path.dirname(shared), { recursive: true })
  if (!fs.existsSync(shared)) {
    fs.copyFileSync(own, shared)
    fs.rmSync(own)
    return `The plugin's mapping now lives in ${shared}, shared with the masterbus tools.`
  }
  if (fs.readFileSync(own).equals(fs.readFileSync(shared))) {
    fs.rmSync(own)
    return `Using the mapping in ${shared}, shared with the masterbus tools.`
  }
  let backup = path.join(path.dirname(shared), BACKUP)
  for (let n = 2; fs.existsSync(backup); n++) {
    backup = path.join(path.dirname(shared), `mapping.plugin-backup-${n}.json`)
  }
  fs.copyFileSync(own, backup)
  fs.rmSync(own)
  return (
    `Using the mapping in ${shared}, shared with the masterbus tools. The plugin had its own ` +
    `mapping, which differs; it is kept as ${backup}.`
  )
}
