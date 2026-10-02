# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The editor names suggestions of the daemon's new `built` tier (masterbus
  ≥ 0.4.4): a path put together from the field's group, name and unit where
  no rule knows the field, shown as "built from the group, field name and
  unit; check it". With an older daemon nothing changes.

## [0.2.0] - 2026-09-22

### Added

- First release. A Signal K plugin over `masterbus-signalk` (masterbus
  ≥ 0.4.2): runs the daemon locally from a bundled per-platform binary, or
  connects to one elsewhere; republishes its delta stream (values, unit
  metadata, notifications) through `handleMessage`; a browser editor for
  the mapping with suggestions and live validation from the daemon; and
  PUT handlers for mapping entries marked `"put": true`, with an optional
  installer login.
