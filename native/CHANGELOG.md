# Native whole-PC optimizer changelog

## Unreleased

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

- Added a local Windows/Linux agent with bounded VQ plan intake.
- Added CPU, memory, load, and optional NVIDIA GPU observation.
- Added fixed platform command allow-lists for safe power/process controls.
- Added preview-first cache cleanup with explicit approval and symlink refusal.
- Added a separate preview/confirm/rollback-capable file organization path.
- Added facts, optimization, cache, and organizer CLI commands.
