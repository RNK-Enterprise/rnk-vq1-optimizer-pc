# Release Notes — v3.1.1

Status: working release candidate. Odinn sign-off is still required before
this repository is called release-certified.

## PC release surface

- Added Storage Pressure Guard monitoring for system-drive free-space pressure
  with configurable warning/critical/emergency thresholds and a default 5 GiB
  free-space floor.
- Added bounded previews for temporary, package, browser automation, shader,
  Windows Update, and explicitly supplied abandoned-runtime categories. Only
  explicitly enabled safe categories may be automatically cleaned; protected
  paths, projects, credentials, repositories, models, WSL data, active
  runtimes, pagefiles, and system-managed files remain outside its authority.
- Added exact candidate byte counts and cleanup audit records with measured
  post-cleanup free-space recovery.
- Removed the non-PC module, relay, server, UI, templates, and test surface.
- Added strict expiry validation with a bounded plan lifetime.
- Restricted remote gateway URLs to HTTPS and loopback development URLs to
  explicit local hosts.
- Scrubbed gateway and VQ credentials from child-process environments.
- Distinguished optimizer-owned temporary files from platform/driver shader
  caches in code and documentation.
- Replaced the former application workload benchmark with a host-observation
  benchmark covering facts latency, event-loop delay, temporary I/O,
  power-state visibility, and cache preview/reclamation behavior.
- Added full PC-tree coverage collection and independent CI verification.
- Changed installers to the public repository and immutable refs.
- Added signed-tag, checksum, provenance, and build-attestation release
  workflow policy.
- Updated development tooling and added production/high-severity dependency
  audit gates; the remaining moderate audit finding is confined to the
  coverage toolchain and has no patched upstream release.
- Added a native Windows CI parser check for the installer.

## Evidence boundary

The engine and turbo counts are inventory data, not proof of optimization.
The benchmark is observational and applies no system actions. Local tests do
not prove a clean-machine install, Windows execution, live gateway, or
administrator-approved apply.

The current checkout must still be independently verified on Windows and by a
live gateway before release certification. Signed release publication also
requires an available signing key; no unsigned tag is presented as certified.
