# Release Notes — v3.1.2

Status: candidate. Odinn sign-off, target-machine proof, a live gateway check,
and signed-tag/build-attestation verification are still required before this
repository is called release-certified.

## v3.1.2 candidate changes

- Windows SMART now preserves inventory disk identity through
  `\\.\PhysicalDriveN`; missing mappings and invalid smartctl output remain
  explicit unavailable states.
- Windows pagefile management and commit accounting report observed state,
  allocation/current/peak usage, commit limit/free commit, timestamps, and
  source authority without deriving facts from physical RAM.
- Windows network limiting reports the requested PID, resolved executable,
  application-path policy, rate, and verification; IPv4/TCP-only counter
  coverage remains explicit.
- Windows process limits use a named, queryable Job Object lifecycle and report
  `RESTART_REQUIRED_TO_RELAX_LIMIT` when active processes cannot be relaxed.
- Cross-volume placement and browser relocation close and hash both copies
  before source deletion, return hashes/deletion state, and support preserving
  the source.
- Production packages install runtime dependencies only and Windows supports
  explicit destinations including `E:\\RNK-Vortex-Optimizer`.
- Release installers and CI can require an exact RNK signing-key fingerprint.
  The actual fingerprint must be supplied by the release owner; no fingerprint
  is invented here.

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
- Scrubbed gateway credentials from child-process environments.
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
