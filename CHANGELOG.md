# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-10-14

### Fixed

- Bundles masterbus 0.4.6. On a big bus, a device the daemon first heard
  after its start-up walk took many minutes to appear (or did not appear at
  all), and reads from the editor or `masterbus-tui` could wait 20 s or
  more. Both now take seconds.

## [0.3.0] - 2026-10-14

### Added

- Bundles masterbus 0.4.5. `masterbus-tui` now works while Signal K runs:
  the daemon shares the USB link with the masterbus tools on the same
  computer (same user account), so the plugin no longer has to be stopped
  to browse devices or edit the mapping. Values arrive about once a
  second on a big bus (they used to lag up to 3 s), a device that is
  switched off no longer slows the others down, and fields shown only at
  installer level that the mapping names are published.

### Fixed

- **The schema cache stays on with an explicit transport** (#1). With
  _Transport_ set to SocketCAN or USB link, the plugin wrote a `config.ini`
  without `cache_dir`, so the daemon ran without its cache and repeated a
  full discovery on every Signal K start. The plugin now keeps an existing
  `cache_dir`, or points it at `cache/` in its data directory, where the
  daemon puts it on auto-detect.
- **Auto-detect no longer attaches to the NMEA 2000 bus** (#2). The plugin is
  enabled by default, and on its first start the daemon took the only CAN
  interface when no USB link was found; on a Signal K computer that is
  usually NMEA 2000. Auto-detect now uses a Mastervolt USB link only. With
  none plugged in the daemon is not started and the status says how to
  choose SocketCAN. A `config.ini` written by an earlier version is kept as
  it is.
- `config.ini` no longer gains a "Managed by the Signal K plugin" comment
  line on every start.

### Changed

- **The plugin and the masterbus tools share one mapping and schema
  cache.** In bundled mode the daemon kept a `mapping.json` of its own, so
  a mapping made in `masterbus-tui` never reached Signal K and the two
  drifted apart unnoticed. The daemon now reads the tools' `mapping.json`
  (on Linux `~/.config/masterbus/`) and uses their schema cache, and picks
  up a change to the file within seconds. On upgrade the plugin's mapping
  moves there; if the tools already had one, theirs is used and the
  plugin's is kept as `mapping.plugin-backup.json`, and the status says
  so. The new _Mapping and schema cache_ setting can keep them in the
  plugin's folder instead, and _Shared folder_ names another place. In a
  container the plugin keeps its own unless a shared folder is named.

## [0.2.1] - 2026-10-02

### Changed

- Bundles masterbus 0.4.4. Its suggestions know many more devices
  (MasterShunts, the MCU combi, digital switching channels, interfaces,
  isolation transformers), propose camelCase instance ids as the Signal K
  specification wants them, and pre-fill a path built from the field's
  group, name and unit where no rule knows the field.

### Added

- The editor names that new `built` suggestion tier: "built from the
  group, field name and unit; check it".

## [0.2.0] - 2026-09-22

### Added

- First release. A Signal K plugin over `masterbus-signalk` (masterbus
  ≥ 0.4.2): runs the daemon locally from a bundled per-platform binary, or
  connects to one elsewhere; republishes its delta stream (values, unit
  metadata, notifications) through `handleMessage`; a browser editor for
  the mapping with suggestions and live validation from the daemon; and
  PUT handlers for mapping entries marked `"put": true`, with an optional
  installer login.
