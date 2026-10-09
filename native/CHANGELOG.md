# Native whole-PC optimizer changelog

## Unreleased

- Packaged System Drive Guard observations now persist to the isolated append-only
  workstation history, including pressure, pagefile, eligible bytes, plan ID, and
  before/after cleanup audit facts without expanding cleanup authority.
- Added fixed macOS `taskpolicy` background/unbackground I/O priority actions for
  approved process targets; hard CPU and memory caps remain explicit unsupported
  results rather than being misrepresented as equivalent controls.
- Added a bounded browser native-messaging download-preflight bridge and an
  advisory browser adapter. It exchanges only size and mount facts, has no HTTP
  listener, and now supports explicitly configured cancellation at the browser
  filename-determination boundary without rewriting downloads.
- Added bounded NVIDIA GPU power-policy preview/apply for supported Windows and
  Linux hosts when current, minimum, and maximum watt limits are observed;
  universal frame-rate and non-NVIDIA GPU caps remain unsupported.
- Added a packaged System Drive Guard launcher that continuously observes the
  configured free-space floor with the existing protected-root and approval
  boundaries; automatic cleanup remains opt-in and category-limited.
- Added optional Linux NetHogs and macOS nettop per-process receive/send-rate
  evidence to the facts layer and network overview. Missing host capabilities
  remain explicit unavailable results; no traffic shaping is implied.
- Extended daily workstation reports with the latest bounded top process
  network user and the count of samples containing native process evidence.
- Added a cross-platform packaged-session user-data path resolver for Windows,
  Linux, and macOS. Packaged dashboard launchers now use isolated per-user
  history and report paths instead of requiring manual path arguments.
- Added a packaged continuous-steward launcher that runs the existing bounded
  observation and daily-report loop with the same isolated per-user paths.
- Corrected packaged continuous reports to serialize as HTML by default when
  the default `.html` destination is used; explicit report formats remain
  available.
- Connected packaged report-schedule preview/apply to the same isolated
  per-user paths and explicit HTML default without bypassing approval.
- Aligned the user-level scheduler format allow-list with the existing HTML
  report delivery so scheduled packaged dashboards are valid plans.
- Added an approval-gated native tray session for Windows, Linux, and macOS.
  Each plan writes one local HTML snapshot first, then starts only the fixed
  platform tray host; missing host tooling remains an explicit apply refusal.

- Added the reproducible cross-platform runtime package boundary and fixed
  Windows, Linux, and macOS dashboard launchers; tray lifecycle remains outside
  this public authority.
- Added the one-shot `steward-snapshot` command so a fresh workstation report
  can be collected and persisted without starting a long-running monitor or
  daemon; it reuses the existing append-only history and report delivery paths.
- Added bounded cumulative per-process read/write I/O evidence to Windows
  `Win32_Process` rows and Linux `/proc/<pid>/io` observations. Missing or
  unsupported counters remain unavailable, and the facts layer does not turn
  cumulative counters into rates without an explicit second sample.
- Added optional fixed NVIDIA compute-process memory evidence and attached it to
  matching process facts without claiming graphics-process coverage or GPU
  enforcement.
- Added a trigger-based `process-rate-monitor` that derives bounded CPU,
  read/write I/O, memory-delta, and observed GPU-memory rates from matching
  process samples; PID identity changes, missing counters, and counter resets
  remain explicit and the monitor has no process-control authority.
- Extended daily workstation reports with measured process CPU and read/write
  I/O peaks, latest leaders, rate-ready sample counts, and counter-reset events
  from the same bounded two-sample evidence.
- Extended the deterministic workstation assistant to answer report-backed
  process CPU and I/O leader questions without adding execution authority.
- Added an explicit bounded multi-drive SMART observer that reuses validated
  inventory devices without changing normal inventory-only facts collection.
- Corrected the Linux mounted-volume command so GNU `df` no longer receives the
  mutually exclusive `-P` and `--output` flags.
- Added a self-contained escaped HTML daily-report dashboard format for local
  scheduled delivery; it opens in a browser without adding a server or network
  transport.
- Extended network-overview to join explicit per-process rates with observed
  PID connection counts without inferring byte ownership or adding throttling.
- Added an approval-gated `report-open` handoff for explicit local HTML reports;
  it uses the fixed platform opener and refuses URLs and non-HTML paths.
- Added the bounded cross-platform `volume-storage` observer and system-facts
  integration for mounted-volume free/total/used evidence. PowerShell
  `Get-Volume`, Linux `df`, and macOS `df` remain fixed read-only commands;
  malformed, unsupported, and failed volume probes stay unavailable.
- Added read-only placement recommendations that combine explicit volume
  free-space, health, writability, protection, and SSD/HDD evidence before
  suggesting capacity-media destinations for models and archives.
- Extended the deterministic workstation assistant's storage answers to retain
  bounded mounted-volume evidence alongside system-drive pressure facts.
- Extended the observational host benchmark's cache-reclamation evidence with
  bounded byte estimates in addition to candidate counts; it still performs
  only a dry run and applies no system action.
- Extended audited before/apply/verify fact snapshots with bounded mounted
  volume evidence so storage and placement actions retain multi-volume proof.
- Expanded explicit regenerable cache-root evidence for pip, Yarn, pnpm, Cargo,
  and Playwright alongside the existing npm, Puppeteer, and Selenium roots;
  no active runtime or user-data discovery was added.
- Added an approval-gated, reversible user-level daily-report scheduler for
  Windows Task Scheduler, Linux systemd user timers, and macOS launchd agents;
  schedule artifacts are fixed, local, and cleaned up on failed installation.
- Added explicit Linux cgroup-v2 `io.max` byte-rate enforcement for hard I/O
  budgets when the caller supplies observed block-device `major:minor` evidence;
  Windows and macOS continue to return unsupported I/O byte-rate results.
- Added the browser-owned local music host with bounded queue, shuffle, repeat,
  seek, next/previous, and object-URL cleanup for user-selected media objects;
  remote URLs and filesystem-path access remain outside its authority.
- Extended organizer preview/apply plans with protected-root precedence so
  project, model, credential, WSL, and user-designated paths cannot be moved;
  organizer CLI commands now accept the same comma-separated protected roots.
- Added read-only fan-RPM telemetry from Linux hwmon and Windows
  `Win32_Fan`; macOS and missing sensor paths remain explicitly unavailable,
  with no firmware or fan-control authority.
- Corrected Windows battery evidence to combine `Win32_Battery` with the
  read-only `BatteryStaticData`, `BatteryFullChargedCapacity`, and
  `BatteryCycleCount` WMI classes so design capacity, full-charge capacity,
  and cycle count are reported when the host exposes them.
- Added bounded storage-growth evidence for repeated free-space and
  reclaimable-category observations; the live storage monitor now reports
  growing categories without adding scan, delete, or move authority.
- Added an explicit local media session that connects queue state to the fixed
  platform default-player opener only after approval; preview and failed-open
  results never mark the track as playing.
- Added fixed read-only Windows, Linux, and macOS network-connection evidence
  with PID, endpoint, protocol, and state attribution; connection facts remain
  distinct from per-process byte rates and traffic-shaping authority.
- Added explicit local JSON/Markdown daily-report delivery with bounded output,
  caller-selected paths, restrictive file mode, and delivery receipts; the
  scheduler and daemon can persist reports without installing a service.
- Extended the abandoned-runtime cleanup input to accept multiple explicit
  comma-separated roots while retaining approval and protected-path checks.
- Extended the ESLint configuration and lint command to cover the split native
  `.mjs` CLI adapters as well as the JavaScript authority modules.
- Split the native CLI into bounded argument, maintenance, media, and
  dispatch modules; each source file remains below the 500-line limit without
  changing the command surface or approval defaults.
- Exposed explicit user protected roots on Storage Pressure Guard preview and
  monitor commands so project, model, and document boundaries reach the same
  cleanup authority as built-in protected roots.
- Added a path-only persistent protected-roots registry with explicit
  read/add/remove commands; malformed or unavailable registries fail closed,
  and Storage Pressure Guard can load the registry before planning cleanup.
- Hardened Storage Pressure Guard CLI category parsing so a bare `--enable`
  flag is rejected instead of being mistaken for an explicit category list.
- Added fixed shell-free Linux swap observation as separate system-managed
  pagefile evidence; swap remains permanently excluded from cleanup.
- Extended system-managed swap observation to macOS through fixed `sysctl`
  `vm.swapusage` facts with the same no-cleanup boundary.
- Added separate battery charge and discharging-only trends to distinguish
  active drain evidence from long-term battery-health movement.
- Added bounded Linux CPU thermal-throttle counter evidence and preserved
  missing throttle sensors as unknown in daily reports.
- Added fixed NVIDIA GPU thermal-throttle reason evidence on Windows and Linux;
  unsupported or missing GPU telemetry remains unavailable, and daily reports
  count observed GPU thermal-throttle events separately from CPU thermal data.
- Added GPU thermal-throttle event counts and recommendations to multi-day
  workstation trends, preserving unknown samples when the GPU sensor is absent.
- Made the local music player's shuffle control select a different queued track
  on `next`, with injectable randomness for deterministic host validation.
- Added exact-name developer workload classification for Codex, OpenCode,
  Node, Python, Git, compilers, WSL, and known local model runtimes; unknown
  processes remain unknown and classification grants no mutation authority.
- Added narrow automatic game detection from observed Steam
  `steamapps/common` executable paths on Windows and Linux; arbitrary names
  and untrusted paths remain unknown, and path evidence grants no mutation
  authority by itself.
- Added Linux cgroup-v2 `memory.max` enforcement with explicit `prlimit`
  address-space fallback when the memory controller is unavailable.
- Added separate GPU temperature evidence to daily workstation reports, with
  canonical and alternate host field support and explicit unavailable states.
- Extended the deterministic workstation assistant to include GPU temperature
  when explaining the highest observed thermal reading.
- Added pagefile-growth and GPU-thermal trend series and recommendations to
  the bounded multi-day workstation history reducer.
- Added Linux cgroup-v2 CPU hard-limit enforcement for approved PIDs with
  controller detection and fail-closed setup/write errors.
- Added a deterministic top-three `priorities` view to daily workstation
  reports without removing the complete recommendation list.
- Added pagefile-pressure event counts and recommendations to daily reports;
  system-managed pagefiles remain observation-only.

- Added cross-platform interface bandwidth-rate derivation and a trigger-based
  `network-rate-monitor` command with counter-reset and per-process authority
  boundaries.
- Added receive/send rate evidence, rate-ready sample counts, and counter-reset
  visibility to the retained daily workstation report.
- Added explicit `workload-budget --hard` planning for bounded CPU and memory
  resource-limit actions, while preserving priority-only I/O and GPU evidence
  boundaries.
- Added a deterministic workstation policy planner and exact-ID approval gate
  for cross-domain handoffs without autonomous host mutation.
- Added read-only policy state and approval-gated handoff counts to daily
  workstation reports.
- Added a reversible quarantine authority and cache-quarantine CLI workflow
  with separate-root, protected-path, symlink, same-volume, exact-receipt,
  and rollback boundaries.
- Added bounded category-to-volume file placement policy planning from prior
  file-insights scans, with protected/incomplete/duplicate exclusions and
  delegated copy-verify-delete apply/rollback authority.
- Added exact-entry startup preview/apply/restore authority for Linux, macOS,
  and allow-listed Windows Run registry locations with protected-name, symlink,
  admin, and reversible-receipt boundaries.
- Added the cross-platform `steward-daemon` runtime and `steward-daemon` CLI
  command to coordinate bounded observation history and one-per-day reports in
  one signal-aware process without installing an operating-system service.
- Added explicit resource-limit preview/apply commands with approved-PID
  boundaries, Windows Job Object CPU/memory enforcement, Linux cgroup-v2 CPU
  and `prlimit` memory enforcement, and explicit unsupported results for macOS.
- Added the cross-platform `steward-scheduler` module and `steward-schedule`
  CLI command for caller-owned daily report delivery.
- Extended the deterministic assistant with report-backed daily-priority
  answers and explicit missing-report handling.

## 2026-10-08

- Added the bounded Storage Pressure Guard with configurable pressure levels,
  target free-space floor, fixed reclaimable categories, protected-path
  precedence, symlink refusal, and explicit approval boundaries.
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
- Added separate Windows pagefile pressure evidence with cleanup permanently
  disabled for system-managed storage.
- Added preview, confirmed cleanup, audit records, and trigger-based monitor
  CLI commands with opt-in safe-category automatic cleanup.
- Added bounded append-only workstation history and a cross-platform report
  monitor with explicit callback delivery.
- Added cross-platform process, battery, thermal, and network telemetry with
  fixed commands, bounded output, and fail-closed unavailable states.
- Added bounded download preflight, incomplete/duplicate scanning, and
  SHA-256 verification commands with no downloader or filesystem mutation.
- Extended continuous download monitoring with current Storage Pressure Guard
  evidence and an explicit download-filling-volume risk when measured growth
  coincides with critical or emergency free-space pressure.
- Added fixed-root startup inventory for Windows, Linux, and macOS with
  review-only entries and no disable or launch authority.
- Added authority-side append-only audit wrapping for optimize actions with
  bounded before/preview/apply/verify evidence.
- Added a bounded cross-platform media catalogue with audio/video/image
  discovery, duplicate evidence, favorites, recent history, playlists,
  import/export, and explicit player-host handoff plans without media-file
  mutation.
- Added confirmed local-media playback through fixed shell-free platform
  default-player openers with symlink and extension refusal.
- Added confirmed opening of allow-listed HTTPS media panels through fixed
  shell-free platform default-browser openers.
- Added bounded read-only local media metadata collection through fixed
  shell-free `ffprobe` invocation with explicit unavailable states.
- Added the cross-platform `game-session` monitor for explicit game detection,
  approved background priority application, and exact-evidence restoration.
- Extended the SMART observer to retain available drive temperature, percentage
  used, power-on hours, unsafe shutdowns, and critical-warning evidence.
- Added the bounded filesystem-health observer for explicit roots with fixed
  platform commands and fail-closed checker results.
- Added bounded fact retention to steward report history and a daily report
  reducer with storage, memory, CPU/GPU, thermal, battery, pagefile, process,
  network, workload, gaming, and cleanup evidence.
- Added a bounded workload governor for explicit gaming/build coexistence,
  approved-PID process and I/O priority application, protected-process
  exclusion, and explicit unsupported hard-cap dimensions.
- Added a workload-budget supervisor for observed CPU/I/O breaches, approved
  soft-priority responses, trigger monitoring, and unsupported memory/GPU
  hard-cap states.
- Added cross-platform drive inventory and optional validated SMART health
  observation with fail-closed unavailable states.
- Added explicit cross-volume file placement preview, copy verification,
  protected-root checks, approval, and rollback support.
- Added deterministic facts-only workstation question routing and named power
  profile preview/apply/recommendation controls with fixed platform mappings.
- Added process/startup overview and exact approved-PID stop workflows with
  protected-role, foreground, and admin boundaries.
- Added bounded trigger-based download progress observation with active,
  stalled, incomplete, completed, and throughput evidence.
- Added explicit-root read/write benchmark evidence with verified temporary
  samples and bounded cleanup.
- Added network contention review from interface facts and explicit per-process
  rates without claiming unavailable bandwidth authority.
- Added deterministic local media queue/player state and HTTPS-only media-panel
  handoff plans without decoder or download authority.
- Added bounded multi-day trend reduction for storage, battery, thermals,
  memory, and drive-failure evidence.

## 2026-10-06

- Kept the native PC surface and its validation files attributed to Lisa's Dungeon.

## 2026-10-05

- Added a local Windows/Linux agent with bounded gateway plan intake.
- Added macOS `netstat -ib` receive/send byte-counter parsing so bandwidth
  history can derive interface rates when the host exposes those counters.
- Added bounded macOS `diskutil info -plist` enrichment for SSD/HDD, model, and
  size evidence while retaining the fixed-device and read-only boundary.
- Added CPU, memory, load, and optional NVIDIA GPU observation.
- Added fixed platform command allow-lists for safe power/process controls.
- Added preview-first cache cleanup with explicit approval and symlink refusal.
- Added a separate preview/confirm/rollback-capable file organization path.
- Added facts, optimization, cache, and organizer CLI commands.
## Unreleased

- Added complete strict coverage for the bounded `cli-utils.mjs` adapter,
  including option parsing, malformed input, protected-root state, storage
  policy, and factory paths. The adapter refuses invalid values without
  changing native authority boundaries.

- Added strict ESM-aware coverage for the public-boundary and release-
  provenance command wrappers, including success, refusal, failure, and
  direct-entrypoint behavior.

- Added strict ESM-aware coverage for the media CLI adapter, including local
  catalogue state, player state, metadata refusal, playback approval, and
  allow-listed panel boundaries without launching external media hosts.

- Added strict ESM-aware coverage for the observational host-benchmark adapter,
  including argument parsing, JSON and human-readable output, failure handling,
  and direct-entrypoint behavior. The adapter remains evidence-only and does
  not claim a performance result from coverage.

- Added strict ESM-aware coverage for the maintenance command adapter across
  storage guard monitoring, protected roots, cache quarantine, organization,
  file insights, steward history/reports/scheduling, and download observation.
  Tests use bounded temporary roots or injected observation doubles so no live
  cleanup, process control, or scheduled task is performed by the coverage run.

- Added strict ESM-aware coverage for the top-level native CLI adapter, including
  workload, budget, resource, power, process, startup, drive, network, placement,
  assistant, policy, media, and entrypoint dispatch boundaries. The tests keep
  host mutations behind injected approval doubles or explicit refusal paths.

- Corrected the workload-governor documentation so supported Windows/Linux CPU
  and memory resource-limit authorities are not described as universally
  unsupported; GPU hard caps remain explicitly unavailable.

- The HTML daily dashboard now surfaces observed CPU/GPU load and thermal
  evidence, pagefile pressure, battery charge/cycles, throttle events,
  abnormal-process events, and cleanup action counts alongside the existing
  storage and workload sections.

- Daily reports now retain the latest bounded drive rows (device, model, media
  type, health, and available SMART fields) so the HTML dashboard can show
  which drive needs attention instead of only aggregate failure counts.

- Expanded the local HTML workstation report dashboard with bounded volume,
  drive-health, network-rate, workload-contention, cleanup, and policy evidence.
  Missing evidence remains visibly `unknown` or an explicit empty-state row;
  the dashboard remains self-contained and does not transmit report data.

