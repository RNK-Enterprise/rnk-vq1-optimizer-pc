# Changelog

## Unreleased

- Added a bounded trigger-based daily report scheduler with one-delivery-per-day
  suppression, forced delivery, callback error handling, and a CLI command.

## 2026-10-08

- Removed the unpatched `sprintf-js` transitive dependency from the Jest
  coverage toolchain by enforcing the maintained `js-yaml` 4 graph.
- Added analysis-only Workload Policy and Download Guard engine families for
  Developer, Gaming, Gaming+Build, and bounded download placement workflows.
- Added the cross-platform Workstation Steward engine family for resource and
  game policy, drive/file/download evidence, daily trend reports, local media
  and music catalogues, fixed workstation intents, and reversible action
  receipts.
- Added confirmed local-media playback through fixed shell-free platform
  default-player openers without remote fetching or downloading.
- Added an append-only native steward history store and cross-platform report
  monitor with explicit delivery callbacks and no automatic host mutation.
- Added bounded cross-platform process, battery, thermal, and network telemetry
  to the native facts path with fixed commands and fail-closed sensor states.
- Added native download preflight, bounded root scanning, duplicate/incomplete
  review, and SHA-256 verification without downloader or filesystem mutation.
- Added cross-platform startup inventory facts from fixed Windows, Linux, and
  macOS startup locations with review-only authority.
- Added append-only native action auditing for optional before/preview/apply/
  verify evidence around approved optimize operations.
- Added a bounded cross-platform media library for local catalogue scanning,
  duplicate evidence, favorites, recents, playlists, import/export, and
  player-host handoff planning without media-file mutation.
- Added persistent bounded telemetry facts to steward history and a
  cross-platform daily workstation report command with explicit missing-data
  states and no host mutation.
- Added the native workload governor bridge for previewed and explicitly
  approved gaming/build process-priority policies across supported adapters;
  hard CPU/RAM/GPU caps remain fail-closed unsupported outcomes.
- Added cross-platform drive inventory and optional SMART observation to the
  native storage evidence path without treating inventory metadata as health
  proof.
- Added explicit cross-volume placement with protected roots, free-space
  evidence, copy verification, confirmation, and rollback support.
- Added deterministic local workstation question routing and named power
  profile recommendations with approval-gated platform-safe application.
- Added process/startup explanations and exact PID stop preview/apply with
  protected-role and foreground refusal boundaries.
- Added trigger-based download progress monitoring with active/stalled states
  and measured throughput without downloader mutation.
- Added explicit-root read/write drive evidence with verified temporary samples
  and bounded cleanup.
- Added cross-platform network contention review from interface facts and
  explicit per-process rates, with unavailable bandwidth evidence preserved.
- Added local media queue/player state and HTTPS-only media-panel handoff
  planning without decoder or download authority.
- Added bounded multi-day workstation trend reporting for storage, battery,
  thermals, memory, and drive-failure evidence.
- Corrected the public mesh inventory documentation to match the strict PC
  completeness gate: 34 engines, 136 turbos, and 170 libraries.
- Added the analysis-only workstation-health engine family for daily reports,
  resource pressure, storage trends, workload contention, and cleanup audits.
- Kept the public PC mesh separate from the private VQ1 stack and retained the
  strict 100% runtime coverage gate.
- Added the Storage Pressure Guard workflow for continuous system-drive
  monitoring, exact bounded cleanup previews, safe-category opt-in cleanup,
  separate pagefile evidence, protected paths, and measured cleanup audits.
- Carried bounded storage-pressure and target-floor evidence through the
  system-facts and storage-capacity analysis surfaces without granting them
  filesystem authority.
- Reduced the public repository to the PC optimizer surface only.
- Added strict native plan expiry and gateway URL validation.
- Scrubbed sensitive environment variables before native child processes.
- Added full PC runtime coverage collection, host-observation benchmarking,
  immutable installer refs, CI, and release provenance policy.
- Corrected public installer repository URLs.
- Updated Jest, Babel, and ESLint tooling and added production/high-severity
  dependency audit gates.
- Added native Windows PowerShell parsing in CI and migrated ESLint to its
  supported flat configuration.
