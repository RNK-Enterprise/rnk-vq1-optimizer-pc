# Packaging changelog

## 2026-10-09

- Added a reproducible cross-platform runtime package builder.
- Added fixed Windows, Linux, and macOS dashboard launchers.
- Added package manifest output and source/output boundary checks.
- Added deterministic SHA-256 entries for each packaged runtime file and
  launcher.
- Added manifest verification for path safety, file-set drift, and hash
  mismatches.
- Added signed-tag release workflow publication for Linux, macOS, and Windows
  runtime bundles after build and manifest verification.
- Normalized runtime archive ordering, timestamps, and ownership metadata for
  reproducible release artifacts.
- Fixed packaged dashboard launchers to pass the packaged-session flag so a
  fresh bundle resolves its per-user history and HTML report paths directly.
- Added matching dashboard and continuous-steward launchers to every runtime
  bundle; both launchers are included in manifest hashing and verification.
- Set the continuous-steward launcher's default report format to HTML so its
  default daily report has the declared artifact type.
- Kept services, listeners, tray lifecycle, and privileged behavior outside the
  package builder's authority.
