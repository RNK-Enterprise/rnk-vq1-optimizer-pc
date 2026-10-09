# Packaging changelog

## 2026-10-09

- Added a reproducible cross-platform runtime package builder.
- Added fixed Windows, Linux, and macOS dashboard launchers.
- Added package manifest output and source/output boundary checks.
- Added deterministic SHA-256 entries for each packaged runtime file and
  launcher.
- Kept services, listeners, tray lifecycle, and privileged behavior outside the
  package builder's authority.
