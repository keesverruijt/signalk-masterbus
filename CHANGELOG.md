# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
