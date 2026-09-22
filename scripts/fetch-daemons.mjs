#!/usr/bin/env node
/**
 * Fetch the masterbus-signalk daemon for every platform the plugin supports
 * into bin/<os>-<arch>/, from the masterbus GitHub release whose version
 * package.json pins under "masterbusDaemon". Run before publishing (it is
 * part of prepublishOnly) and in a development checkout that wants the
 * bundled daemon rather than a --binaryPath.
 *
 * Needs `tar` on PATH (macOS, Linux and Windows 10+ all have it).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
// MASTERBUS_DAEMON_VERSION overrides the pin, for trying a build that is not
// released yet or checking the script against an older release.
const version = process.env.MASTERBUS_DAEMON_VERSION ?? pkg.masterbusDaemon
if (typeof version !== 'string') throw new Error('package.json has no "masterbusDaemon" version')

// Node's platform/arch names → the Rust target masterbus releases are built for.
const TARGETS = {
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'linux-arm': 'armv7-unknown-linux-musleabihf',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc'
}

// `--current` fetches this machine's daemon only; `--only <os-arch>` one platform.
const onlyArg = process.argv.indexOf('--only')
/** Fetch a URL, retrying a few times on a transient failure (GitHub's
 * release downloads occasionally answer 5xx). */
async function download(url, attempts = 4) {
  let last
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (res.ok) return Buffer.from(await res.arrayBuffer())
      if (res.status >= 400 && res.status < 500) throw new Error(`HTTP ${res.status}`)
      last = new Error(`HTTP ${res.status}`)
    } catch (err) {
      if (err instanceof Error && /^HTTP 4/.test(err.message)) throw err
      last = err
    }
    if (i < attempts) await new Promise((r) => setTimeout(r, 2000 * i))
  }
  throw last instanceof Error ? last : new Error(String(last))
}

const only = process.argv.includes('--current')
  ? [`${process.platform}-${process.arch}`]
  : onlyArg >= 0
    ? [process.argv[onlyArg + 1]]
    : Object.keys(TARGETS)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'masterbus-daemons-'))
let failed = 0
for (const key of only) {
  const target = TARGETS[key]
  if (!target) throw new Error(`no masterbus target for ${key}`)
  const exe = key.startsWith('win32') ? 'masterbus-signalk.exe' : 'masterbus-signalk'
  const dest = path.join(root, 'bin', key)
  const url = `https://github.com/keesverruijt/masterbus/releases/download/v${version}/masterbus-${target}.tar.gz`
  process.stdout.write(`${key}: ${url} … `)
  try {
    const tarball = path.join(tmp, `${target}.tar.gz`)
    fs.writeFileSync(tarball, await download(url))
    const unpack = path.join(tmp, target)
    fs.mkdirSync(unpack, { recursive: true })
    execFileSync('tar', ['xzf', tarball, '-C', unpack])
    const found = path.join(unpack, `masterbus-${target}`, exe)
    if (!fs.existsSync(found)) throw new Error(`${exe} is not in the tarball`)
    fs.mkdirSync(dest, { recursive: true })
    fs.copyFileSync(found, path.join(dest, exe))
    fs.chmodSync(path.join(dest, exe), 0o755)
    console.log(`ok (${(fs.statSync(found).size / 1e6).toFixed(1)} MB)`)
  } catch (err) {
    failed++
    console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`)
  }
}
fs.rmSync(tmp, { recursive: true, force: true })
if (failed) {
  console.error(`${failed} platform(s) missing; the package must not be published like this`)
  process.exit(1)
}
