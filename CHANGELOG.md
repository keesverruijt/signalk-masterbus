# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **A firmware warning can be cleared from the editor.** After a device's
  firmware is updated, the editor warns that its mapping was written for
  the old version. Once you have checked that its mapped fields still show
  the right names and values, click _Checked: record firmware …_ next to
  the warning and Save. Until now only the TUI or a hand edit of the
  mapping file could clear it (masterbus#46).

### Fixed

- **A device's Signal K instance no longer follows the last field you
  map.** A device can publish under two places, such as a regulator's
  readings under `electrical.alternators.alt-110a` and its `Stop charge`
  under `electrical.switches.alt-110a-stop-charge`. Mapping the switch made
  the editor propose new fields under `alt-110a-stop-charge`. It now keeps
  the instance most of the device's fields use (masterbus#47).

## [0.4.2] - 2026-10-27

### Fixed

- Bundles masterbus 0.5.2:
  - **A slow device's settings are read completely.** Some devices, such
    as a ChargeMaster Plus, answer some of the daemon's questions late
    while it reads their settings. Each start could then show a different
    set of settings, with some missing. Late answers are now kept, and
    the daemon asks once more for what is missing (masterbus#6).
  - Settings already saved in the schema cache are not read again. To get
    the complete list, delete the device's files from the cache folder
    (on Linux `~/.cache/masterbus`, or the plugin's folder with _Plugin
    only_; see the README) and restart Signal K.

## [0.4.1] - 2026-10-27

### Fixed

- Bundles masterbus 0.5.1:
  - **Stop charge stays protected.** An alternator regulator's
    `Stop charge` can't be switched off from Signal K unless the mapping
    allows it, and reads as on/off (masterbus#29).
  - **The USB link comes back after it is unplugged.** The daemon used to
    stop receiving until Signal K was restarted (masterbus#39).
  - **Faster start.** After a restart, each device streams as soon as it
    is identified instead of after the whole bus, so values and switches
    come back sooner on a big bus. An empty mapping file is no longer
    refilled with guesses (masterbus#40).
- An alternator regulator's outputs, such as `Stop charge`, now get the
  "also let Signal K switch it off" box. The regulator reports them as
  writable, so 0.4.0 offered only the ordinary PUT box, which switched them
  off as readily as on. The editor now follows the daemon's `eventOnly`
  mark (masterbus#41). Options without labels no longer show as an enum.
  Thanks to @Peter-Petrik. (masterbus#29)

## [0.4.0] - 2026-10-25

### Added

- The mapping editor shows a device's **eventable outputs**: what other
  devices' events switch, such as an alternator regulator's `Stop charge`,
  including ones no menu lists. Ticking "accept PUTs" on one lets Signal K
  switch it **on**. Switching it **off** needs a second tick, because the
  batteries use the same output for their own protection. Bundles
  masterbus 0.5.0, which does the switching. (masterbus#29)

### Changed

- Bundles masterbus 0.5.0. A switch (a CombiMaster's inverter or charger,
  a DC distributor's output) is now sent in the daemon's own name: it makes
  up a bus id of its own on first start, in a device class no Mastervolt
  product uses, and keeps it in its `config.ini` as `bus_id`. Before, it
  borrowed the id of the MasterAdjust setup the switch was first captured
  from. The plugin keeps that `bus_id` when it writes `config.ini` again.

### Fixed

- Bundles masterbus 0.5.0. On a Raspberry Pi 3, starting the daemon no
  longer disturbs the Pi's USB controller: it used to read debug files that
  dump the controller's registers and run a register test, three times per
  start (#4). A ChargeMaster Plus that reports an impossible number of
  fields no longer stalls its discovery (masterbus#6).
- Updating from 0.2.x no longer deletes `mapping.json` when the masterbus
  tools' folder is a link to the plugin's data folder. The plugin took the
  two paths for two copies of the same mapping and removed one, which was
  the only one. Thanks to @Peter-Petrik for the diagnosis and the fix. (#3)

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
