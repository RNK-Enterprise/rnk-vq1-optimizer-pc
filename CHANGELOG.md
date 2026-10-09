# Changelog

## Unreleased

- Added an independent per-file coverage verifier that fails on any uncovered
  statement, branch, function, or executable line; the global Jest threshold
  can no longer hide a weak file behind another file's coverage.
- Added a one-shot workstation snapshot/report command for immediate local
  health capture and JSON, Markdown, or HTML delivery through the existing
  history and approval boundaries.
- Added a source-backed capability status matrix that separates the completed
  workstation wishlist from the seven remaining product or live-certification
  boundaries instead of repeating the original twenty-item request.
- Added bounded per-process cumulative read/write I/O evidence for Windows and
  Linux Developer Mode, Gaming+Build review, and workstation reports; missing
  platform counters remain unknown rather than inferred.
- Added optional NVIDIA compute-process GPU-memory evidence to matching process
  facts; graphics-process coverage and GPU hard caps remain unsupported.
- Added trigger-based per-process CPU, read/write I/O, memory-delta, and
  observed GPU-memory rates with PID identity and counter-reset handling; the
  new monitor remains observation-only.
- Extended daily workstation reports to surface measured process CPU/I/O peaks,
  latest leaders, rate-ready samples, and counter resets.
- Extended the facts-only assistant with report-backed process CPU/I/O leader
  answers and explicit missing-evidence results.
- Extended the self-contained HTML daily dashboard with process CPU/I/O peaks,
  latest leaders, sampled-rate count, and counter-reset evidence.
- Added an optional caller-owned language adapter that translates bounded JSON
  into the deterministic assistant without granting model output execution authority.
- Exposed that adapter through the explicit `assistant-adapted` CLI boundary;
  its fallback response is caller-supplied JSON, not a network or execution path.
- Added a cross-platform `steward-dashboard` session launcher that writes one
  local HTML report and opens it through the fixed shell-free platform opener.
- Added the reproducible `npm run verify` gate and bounded public-checkout
  identity scanner used by CI and local verification.

## Unreleased

- Removed the private client, protocol, persistence, browser host, and
  sibling-stack completeness gate from the public PC checkout; the public
  surface now contains only native PC authority, PC analysis engines, and the
  bounded local media host.
- Added a CI guard that rejects reintroduction of forbidden sibling-stack
  references into the public checkout.
- Corrected the public engine inventory documentation to 38 engines, 152
  turbos, and 190 libraries.
- Clarified the public verification boundary: the strict Jest 100% gate covers
  every collected JavaScript authority module, while all ESM CLI adapters are
  independently linted and syntax-checked without being misreported as Jest
  coverage.
- Added cross-platform Linux swap-pressure observation as system-managed
  evidence without granting pagefile or swap cleanup authority.
- Extended system-managed swap-pressure observation to macOS through fixed
  `sysctl vm.swapusage` facts without granting swap cleanup authority.
- Added separate battery charge and discharging-only trends to distinguish
  active drain evidence from long-term battery-health movement.
- Added bounded Linux CPU thermal-throttle counter evidence and preserved
  missing throttle sensors as unknown in daily reports.
- Added Linux cgroup-v2 `memory.max` enforcement with explicit `prlimit`
  address-space fallback when the memory controller is unavailable.
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
- Extended the facts-only assistant with report-backed daily-priority answers
  and explicit no-report evidence states.
- Added confirmed local-media playback through fixed shell-free platform
  default-player openers without remote fetching or downloading.
- Added confirmed opening of allow-listed HTTPS media panels through fixed
  shell-free platform browser openers without fetching or downloading.
- Added bounded local media metadata evidence for duration, format, codecs,
  audio channels, and video dimensions through fixed `ffprobe` invocation.
- Added trigger-based game-session supervision with approved background
  priority application and evidence-gated restoration.
- Extended read-only SMART evidence with available temperature, percentage-used,
  power-on-hour, unsafe-shutdown, and critical-warning attributes.
- Extended Windows process telemetry with read-only foreground-window PID
  evidence; unsupported platforms remain explicit rather than inferred.
- Added a trigger-based network contention monitor around explicit platform or
  caller samples, with transition history and no unsupported throttle claim.
- Added bounded read-only file-insights scanning for incomplete downloads,
  stale installers, large files, protected paths, and hash-backed duplicates.
- Added trigger-based battery/thermal/workload power-profile monitoring with
  approval-gated optional application of documented profiles.
- Added fixed balanced/performance CPU-affinity actions for approved Windows
  and Linux process targets; memory/GPU hard policy remains unsupported.
- Added a bounded macOS action adapter for process priority, cache cleanup, and
  approved process stop; unsupported macOS controls remain explicit.
- Added normalized macOS `df` collection to the cross-platform Storage
  Pressure Guard; pagefile cleanup remains permanently disabled.
- Hardened Windows process telemetry against protected-process CPU and start
  time access failures by retaining rows with unavailable fields.
- Added explicit cross-platform read-only filesystem-health evidence through
  fixed Windows, Linux, and macOS volume checkers.
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
- Added bounded workload-budget supervision with trigger-based monitoring,
  approved soft CPU/I/O priority responses, and explicit memory/GPU hard-cap
  evidence states.
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
- Corrected the public mesh inventory documentation to match the public PC
  catalog: 38 engines, 152 turbos, and 190 libraries.
- Added the analysis-only workstation-health engine family for daily reports,
  resource pressure, storage trends, workload contention, and cleanup audits.
- Kept the public PC mesh independent from sibling repositories and retained
  the strict 100% runtime coverage gate.
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
