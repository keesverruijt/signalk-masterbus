# signalk-masterbus

Mastervolt **MasterBus** for [Signal K](https://signalk.org): battery,
charger, inverter and solar values on your Signal K server, a browser
editor for choosing what publishes where, and switches in Signal K that
set fields on the bus.

The plugin is a thin layer over
[`masterbus-signalk`](https://github.com/keesverruijt/masterbus), the daemon
from the masterbus project that speaks the CAN protocol. It runs the daemon
for you on the machine wired to the bus, or connects to one running
elsewhere.

## What you need

A computer that can reach the bus, exactly as for the masterbus tools:

- a **Mastervolt USB Interface** (article 77030200) on Linux, macOS or
  Windows, or
- a **Linux machine with a CAN adapter** (a CANable stick, a PiCAN HAT on a
  Raspberry Pi) with `can0` up at 250 kbit/s.

See the masterbus project's
[HARDWARE.md](https://github.com/keesverruijt/masterbus/blob/main/HARDWARE.md).

## Install

From the Signal K **App Store**, or:

```sh
cd ~/.signalk
npm install signalk-masterbus
```

The daemon binary for your platform (Linux x64/arm64/armv7, macOS, Windows)
comes along as an optional dependency; nothing else to download. Enable
the plugin under **Server → Plugin Config → MasterBus**.

## Two ways to run it

**Bundled** (the default): the plugin starts `masterbus-signalk` on this
machine and keeps its configuration, the mapping and the device schema
cache under `~/.signalk/plugin-config-data/signalk-masterbus/masterbus/`.
With _Transport_ on auto-detect it picks a plugged-in USB link, else the
only CAN interface; set it explicitly when the machine has several. Nothing
listens beyond loopback.

**External**: the machine on the bus is not the one running Signal K. Run
`masterbus-signalk` there (its systemd unit is in the masterbus release
tarball), set `api_listen` and `api_token` in its `config.ini`, and give
the plugin the host, ports and token. Everything below works the same.

A container is not required and not offered: the daemon needs the CAN
interface or the USB device, which a container only complicates.

## Telling it what to publish

Open **MasterBus mapping** from the server's webapp list. It shows every
device on the bus with its fields and live values. Nothing is published
until it is mapped:

- **Map** a field. The path is pre-filled when the bundled per-model
  database or the name heuristics know the field, and the daemon validates
  it as you type: you see the unit conversion it implies (`°C` becomes
  kelvin), and a path whose units cannot be reconciled is refused rather
  than saved.
- An enum onto a boolean leaf (`enabled`, a switch's `state`) gets a **truth
  table**; an enum with a label like `Alarm` gets a **notification table**,
  so a Signal K server can sound it rather than show a word.
- **Accept PUTs** on a writable field, and a switch in Signal K (a dashboard
  toggle, a rule, `PUT /signalk/v1/api/vessels/self/<path>`) sets the field
  on the bus. Writable settings live on a device's _Configuration_ menu;
  the **Load configuration fields** button discovers it.
- **Apply to same article** copies one device's mapping to every other unit
  of the same model, substituting each one's instance.
- **Save mapping** writes it; the daemon picks it up at once.

The first run seeds a mapping from the bundled heuristics so a fresh
install is not silent; treat it as a starting point. Diagnostics for the
saved mapping (a field the device does not have, a firmware that moved
on) are listed under the table.

The file being edited is the daemon's `mapping.json`, the same one
`masterbus-tui --mapping` edits, so both tools can be used on the same
install.

## Writes and the installer code

A field that is read-only at the device's user level needs a Mastervolt
installer login. Enter the code in the plugin settings and writes that
need it log in first. Leave it blank otherwise.

## Development

```sh
npm install
npm run build        # plugin/ (tsc) and public/ (vite)
npm test
npm run lint
```

To run against a daemon without hardware, build masterbus with the
`fake-bus` feature:

```sh
cd ../masterbus && cargo build --release -p masterbus-tools --features fake-bus
```

The plugin passes the daemon its own arguments, so to add `--fake-bus` set
_masterbus-signalk binary_ in the plugin settings to a wrapper script:

```sh
#!/bin/sh
exec /path/to/masterbus/target/release/masterbus-signalk --fake-bus "$@"
```

The daemon's API is documented in the masterbus repository's
[`docs/API.md`](https://github.com/keesverruijt/masterbus/blob/main/docs/API.md).

## License

Apache-2.0.
