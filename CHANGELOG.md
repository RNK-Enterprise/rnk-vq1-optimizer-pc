# Changelog

## 2026-10-08

- Removed the unpatched `sprintf-js` transitive dependency from the Jest
  coverage toolchain by enforcing the maintained `js-yaml` 4 graph.
- Added analysis-only Workload Policy and Download Guard engine families for
  Developer, Gaming, Gaming+Build, and bounded download placement workflows.
- Added the cross-platform Workstation Steward engine family for resource and
  game policy, drive/file/download evidence, daily trend reports, local media
  and music catalogues, fixed workstation intents, and reversible action
  receipts.
- Added an append-only native steward history store and cross-platform report
  monitor with explicit delivery callbacks and no automatic host mutation.
- Added bounded cross-platform process, battery, thermal, and network telemetry
  to the native facts path with fixed commands and fail-closed sensor states.
- Added native download preflight, bounded root scanning, duplicate/incomplete
  review, and SHA-256 verification without downloader or filesystem mutation.
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
