# Native whole-PC optimizer

This directory is the operating-system authority for the public PC release.
The agent measures CPU, memory, and optional NVIDIA GPU facts locally. A
configured optimizer gateway may return a bounded, data-only plan; the local
Windows or Linux adapter owns the executable allow-list and applies only
validated actions.

## Safe use

The Linux and Windows installers require an explicit `headless` or
`interactive` environment choice before installation. The choice controls
the front-end posture only; it does not grant permission to apply actions.
Preview remains the default, and administrative or destructive work remains
separately approved.

```sh
node native/cli.mjs facts
node native/cli.mjs optimize --gateway https://optimizer.example.invalid/v1/plan
node native/cli.mjs optimize --gateway http://127.0.0.1:9999/optimizer/v1/plan
node native/cli.mjs optimize --gateway https://optimizer.example.invalid/v1/plan --apply --approve=clear-cache
node native/cli.mjs optimize --gateway https://optimizer.example.invalid/v1/plan --apply --allow-admin
node native/cli.mjs optimize --gateway https://optimizer.example.invalid/v1/plan \
  --history-path "$HOME/.rnk-optimizer/history.jsonl"
node native/cli.mjs cache-preview --target user-temp --max-age-hours 24
node native/cli.mjs cache-quarantine-preview --target user-temp \
  --quarantine-root "$HOME/.rnk-optimizer/quarantine"
node native/cli.mjs cache-quarantine-apply --target user-temp \
  --quarantine-root "$HOME/.rnk-optimizer/quarantine" --confirm
node native/cli.mjs cache-quarantine-rollback --result '{"version":1,"sourceRoots":["/tmp/cache"],"quarantineRoot":"/tmp/quarantine","moved":[]}'
node native/cli.mjs cache-clean --target user-temp --confirm
node native/cli.mjs storage-preview --target-free-gb 5 \
  --enable=temporary-files,package-cache,browser-automation-cache,gpu-shader-cache \
  --protected-root "$HOME/projects,$HOME/models"
node native/cli.mjs storage-cleanup --target-free-gb 5 \
  --enable=temporary-files,package-cache --confirm
node native/cli.mjs storage-monitor --target-free-gb 5 \
  --enable=temporary-files,package-cache --interval-seconds 60
node native/cli.mjs protected-roots-add \
  --protected-store "$HOME/.rnk-optimizer/protected-roots.json" \
  --root "$HOME/projects,$HOME/models,$HOME/.ssh" --confirm
node native/cli.mjs protected-roots-read \
  --protected-store "$HOME/.rnk-optimizer/protected-roots.json"
node native/cli.mjs organize-preview --root "$HOME/Downloads" \
  --protected-root "$HOME/projects,$HOME/models,$HOME/.ssh"
node native/cli.mjs organize-apply --root "$HOME/Downloads" \
  --protected-root "$HOME/projects,$HOME/models,$HOME/.ssh" --confirm
node native/cli.mjs download-preflight --size-bytes 12800000000 \
  --destination C: --volumes '[{"mount":"C:","freeBytes":8000000000},{"mount":"E:","freeBytes":100000000000}]'
node native/cli.mjs download-scan --root "$HOME/Downloads" --hash-files
node native/cli.mjs download-verify --file "$HOME/Downloads/file.zip" --sha256 HASH
node native/cli.mjs download-monitor --root "$HOME/Downloads" \
  --target-free-gb 5 --interval-seconds 30
node native/cli.mjs steward-report --path "$HOME/.rnk-optimizer/history.jsonl" \
  --window-hours 24 --max-samples 96
node native/cli.mjs steward-schedule --path "$HOME/.rnk-optimizer/history.jsonl" \
  --interval-seconds 900
node native/cli.mjs report-schedule-preview --path "$HOME/.rnk-optimizer/history.jsonl" \
  --output-path "$HOME/.rnk-optimizer/daily-report.json" --time 09:00
node native/cli.mjs report-schedule-apply --path "$HOME/.rnk-optimizer/history.jsonl" \
  --output-path "$HOME/.rnk-optimizer/daily-report.json" --time 09:00 --confirm
node native/cli.mjs report-schedule-restore --receipt '{"version":1,"action":"remove-daily-report-schedule"}' --confirm
node native/cli.mjs steward-daemon --path "$HOME/.rnk-optimizer/history.jsonl" \
  --observation-interval-seconds 900 --report-interval-seconds 900
node native/cli.mjs steward-trends --path "$HOME/.rnk-optimizer/history.jsonl" \
  --window-days 30 --max-entries 512
node native/cli.mjs workload-preview --mode gaming-build --game-names game.exe \
  --background-pids 1234,5678
node native/cli.mjs workload-apply --mode gaming-build --game-names game.exe \
  --approve-pids 1234 --confirm
node native/cli.mjs workload-budget-preview --budget '{"cpuPercent":50}' \
  --target-pids 1234,5678
node native/cli.mjs workload-budget-preview --budget \
  '{"ioBytesPerSecond":52428800,"ioDevice":"8:0"}' \
  --target-pids 1234 --hard
node native/cli.mjs workload-budget-apply --budget '{"cpuPercent":50}' \
  --target-pids 1234 --approve-pids 1234 --confirm
node native/cli.mjs resource-limit-preview --limits '{"cpuPercent":50,"memoryBytes":8589934592}' \
  --target-pids 1234
node native/cli.mjs resource-limit-apply --limits '{"memoryBytes":8589934592}' \
  --target-pids 1234 --approve-pids 1234 --allow-admin --confirm
node native/cli.mjs game-session-monitor --game-names game.exe \
  --background-pids 1234,5678 --interval-seconds 10
node native/cli.mjs game-session-monitor --game-names game.exe \
  --background-pids 1234 --approve-pids 1234 --auto-apply --confirm
node native/cli.mjs drive-health
node native/cli.mjs drive-health --smart-device /dev/nvme0n1
node native/cli.mjs drive-health --smart-all
node native/cli.mjs volume-storage
node native/cli.mjs filesystem-health --root /
node native/cli.mjs drive-benchmark --root "$HOME/.cache"
node native/cli.mjs network-overview --game-pid 1234 --latency-ms 80 \
  --samples '[{"pid":1234,"role":"game","receivedBytesPerSecond":1000}]'
node native/cli.mjs network-rate-monitor --interval-seconds 5
node native/cli.mjs file-inspect --root "$HOME/Downloads" \
  --target-root /mnt/archive --hash-files --protected-root "$HOME/projects"
node native/cli.mjs placement-preview --source-root "$HOME/Downloads" \
  --target-root /mnt/archive --target-free-bytes 100000000000 \
  --files '[{"path":"/home/me/Downloads/model.zip","sizeBytes":12000000000,"category":"models"}]'
node native/cli.mjs placement-recommend \
  --volumes '[{"mount":"E:","mediaType":"hdd","freeBytes":68000000000,"health":"healthy"}]'
node native/cli.mjs placement-apply --source-root "$HOME/Downloads" \
  --target-root /mnt/archive --target-free-bytes 100000000000 \
  --files '[{"path":"/home/me/Downloads/model.zip","sizeBytes":12000000000,"category":"models"}]' --confirm
node native/cli.mjs placement-policy-preview --scan '{"root":"/home/me/Downloads","entries":[],"duplicates":[]}' \
  --target-roots '{"model":"/mnt/archive/models","archive":"/mnt/archive/archives"}' \
  --target-free-bytes '{"/mnt/archive/models":100000000000,"/mnt/archive/archives":100000000000}'
node native/cli.mjs assistant --question "Why is my C: drive full?"
node native/cli.mjs policy-preview --facts '{"memory":{"usedPercent":92}}'
node native/cli.mjs policy-approve --plan '{"version":1,"phase":"recommend","actions":[]}' --approve-ids storage-pressure-review
node native/cli.mjs power-recommend
node native/cli.mjs power-preview --profile gaming
node native/cli.mjs power-apply --profile gaming --confirm
node native/cli.mjs power-monitor --interval-seconds 300
node native/cli.mjs power-monitor --auto-apply --confirm --allow-admin
node native/cli.mjs process-overview --max-entries 128
node native/cli.mjs process-stop-preview --pid 1234
node native/cli.mjs process-stop-apply --pid 1234 --confirm --allow-admin
node native/cli.mjs startup-preview --name Updater --location 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
node native/cli.mjs startup-apply --name Updater --location 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' --confirm
node native/cli.mjs media-scan --root "$HOME/Music" --hash-files
node native/cli.mjs media-playlist --state-path "$HOME/.rnk-optimizer/media.json" \
  --name Morning --tracks '["/music/track-a.mp3","/music/track-b.mp3"]'
node native/cli.mjs media-favorite --state-path "$HOME/.rnk-optimizer/media.json" \
  --file "$HOME/Music/track-a.mp3"
node native/cli.mjs media-playback-plan --state-path "$HOME/.rnk-optimizer/media.json" \
  --file "$HOME/Music/track-a.mp3"
node native/cli.mjs media-play --file "$HOME/Music/track-a.mp3" --confirm
node native/cli.mjs media-player --tracks '["/music/track-a.mp3","/music/track-b.mp3"]' --action next
node native/cli.mjs media-panel --url "https://www.youtube.com/playlist?list=EXAMPLE"
node native/cli.mjs media-panel-open --url "https://www.youtube.com/playlist?list=EXAMPLE" --confirm
node native/cli.mjs media-metadata --file "$HOME/Videos/example.mp4"
```

Remote gateways require HTTPS. Plain HTTP is accepted only for exact
loopback development endpoints. `optimize` is preview-only unless `--apply`
is supplied. Cache cleanup and process stopping require explicit approval.
File organization is never part of an optimization plan; it is a separate
preview/confirm workflow and never overwrites an existing destination.

`cache-quarantine-preview` and `cache-quarantine-apply` provide a reversible
alternative for cache previews. They require a quarantine root separate from
every source root, never follow symlinks, and move only exact preview entries
with same-volume rename. `cache-quarantine-rollback` consumes the apply receipt
and restores entries only when the original path is still unoccupied. A
cross-volume quarantine is refused instead of falling back to copy-and-delete.

Supported controls are Windows power profile/process priority/process affinity,
Linux power profile/process priority/process I/O priority/process affinity and
available cgroup-v2 CPU/memory limits plus explicit `io.max` byte-rate limits
when a block-device `major:minor` pair is supplied, and
macOS process priority, bounded cache cleanup, and approved process stop.
Affinity is limited to fixed balanced/performance masks and requires admin
approval. macOS named power profiles, I/O policy, GPU policy, and memory policy
remain explicit unsupported results; NVIDIA facts are observational only.

The `user-temp` target is optimizer-owned. D3D, NVIDIA, and Mesa shader
caches are platform/driver-generated; the optimizer exposes only fixed,
explicit preview targets and does not claim ownership of those files.

## Storage Pressure Guard

`storage-preview` reads the system drive and reports `normal`, `warning`,
`critical`, or `emergency` pressure. The default target is 5 GiB free and
the default age boundary is 24 hours. Both the pressure thresholds and target
floor are configurable. The Windows collector reports pagefile allocation and
usage separately, Linux uses byte-accurate `df` plus fixed `free -b` swap
evidence, and macOS uses normalized 1-KiB `df` plus fixed `sysctl
vm.swapusage` swap evidence; `pagefile.sys`, `hiberfil.sys`, `swapfile.sys`,
Linux swap, and macOS swap are never cleanup targets. Swap remains unavailable
when the host does not expose a valid result.

The preview only walks fixed roots for explicitly selected categories:
temporary files, package caches, browser automation caches, GPU/shader caches,
Windows Update downloads, and user-supplied abandoned-runtime remnants. It
does not infer a directory's authority from size. It skips symlinks, protected
paths, directories, recent files, and unreadable/racing entries, and it
produces exact candidate paths, byte counts, and a critical/emergency-only
bounded plan. Cleanup requires `--confirm` and an explicit category selection.

`storage-monitor` is trigger-based continuous monitoring. It emits an initial
snapshot and subsequent pressure/floor transitions. `--auto-clean` is opt-in
and can only act on safe categories that were explicitly enabled; it does not
authorize Windows Update or abandoned-runtime cleanup. Every real cleanup
returns an audit record containing the plan ID, estimated bytes, removed bytes,
and measured before/after free-space recovery. The monitor output also includes
bounded in-process growth evidence. Use `--growth-window-hours` and
`--growth-threshold-bytes` to control its comparison window and minimum change;
growth evidence does not expand cleanup authority.

`protected-roots-add` persists user-selected repository, model, credential, WSL,
or document roots in a path-only registry. Pass the same `--protected-store`
to Storage Pressure Guard commands to load it. Registry changes require
`--confirm`; malformed or unavailable registries fail closed.

Pass multiple abandoned-runtime roots as a comma-separated
`--abandoned-root PATH1,PATH2` value. Those roots remain review-only until the
category is explicitly enabled and approved.

The workstation steward also exposes an append-only history store and a
cross-platform observation monitor. `steward-history` supports read, append,
rollback-preview, and quarantine-preview operations; `steward-monitor` records
periodic steward reports and delivers them to stdout. `steward-report` reduces
the retained facts into a daily report with storage, memory, CPU/GPU, thermal,
battery, pagefile, process, network, workload, gaming, and cleanup evidence.
`steward-snapshot` collects one fresh fact sample, appends it to the
caller-owned history, and returns the current report immediately; an explicit
`--output-path` can persist JSON, Markdown, or HTML delivery.
When supplied by the host, GPU temperature is retained separately from the
aggregate thermal reading; missing GPU sensors remain unavailable.
On Windows and Linux, NVIDIA facts also retain the fixed-query thermal-throttle
reason result when `nvidia-smi` exposes it. Daily reports count those events
separately; missing or unsupported GPU throttle evidence remains unknown.
Network evidence includes cumulative interface counters plus derived receive/send
rates when consecutive counters are available; first samples, missing counters,
and counter resets remain explicitly unavailable.
High pagefile-pressure samples add a dedicated recommendation while pagefile
cleanup remains permanently disabled.
The report also includes the latest-evidence policy state and exact handoff IDs
for review; it does not apply those handoffs.
`priorities` contains the first three deterministic recommendations for a
compact daily view; the complete `recommendations` list remains available.
Missing sensors remain missing. Neither command applies the planner's actions
automatically.

`steward-schedule` delivers one report per UTC day while its trigger loop is
running. It writes through a caller-owned delivery callback and does not install
an operating-system task. `report-schedule-preview` builds an exact user-level
schedule plan, and `report-schedule-apply --confirm` installs it through Windows
Task Scheduler, a Linux systemd user timer, or a macOS launchd agent. The receipt
from apply is consumed by `report-schedule-restore --confirm`; failed artifact
installation is cleaned up and no privileged service is created.

Pass `--output-path PATH --format json|markdown|html` to persist the delivered
report as a bounded local artifact. `steward-daemon` accepts the corresponding
`--report-output-path PATH --format json|markdown|html` option. HTML is a
self-contained browser-readable dashboard with escaped data. The file sink is
local-only and does not upload or notify external services. It includes bounded
storage-volume and per-drive device/model/media/health, network, workload, cleanup, and policy sections;
it also surfaces observed CPU/GPU, pagefile, battery, thermal, abnormal-process,
and cleanup counts. Missing evidence remains an explicit unknown or empty state.

`report-open --path PATH` previews opening one explicit local `.html` report;
adding `--confirm` delegates only to the fixed platform default opener. Remote
URLs, non-HTML files, server startup, and arbitrary command execution are
refused.

`steward-daemon` combines the observation and daily-report loops in one
long-running process and stops cleanly on process signals. It does not install
an operating-system service, tray process, scheduler task, or privileged daemon;
the host application owns lifecycle installation.

`steward-trends` reduces retained reports over a bounded multi-day window and
reports storage fill rate, battery-health movement, CPU/GPU thermal movement,
fan-speed movement, memory-pressure movement, battery charge movement while
discharging, pagefile growth, drive-failure evidence, and recommendations.
Battery health decline and active charge drain remain separate observations.

`collectSystemFacts()` now includes bounded process, startup, battery, thermal,
and network telemetry when the host exposes it. Windows uses fixed PowerShell
queries, including cumulative `Win32_Process` read/write transfer counters;
Linux uses fixed `ps` plus read-only `/sys`, `/proc`, and startup
roots; Linux thermal telemetry also reads bounded CPU thermal-throttle counters
when exposed, and process rows include bounded `/proc/<pid>/io` counters when
available. macOS uses fixed `ps`, `pmset`, `netstat`, and startup roots; macOS
process I/O counters remain unavailable. Cumulative counters are not reported as
rates without an explicit second sample.
When `nvidia-smi` exposes compute-process rows, matching process records also
carry observed GPU-memory bytes; graphics-process coverage and GPU enforcement
remain unavailable unless the driver reports them through that fixed query.
Windows battery telemetry combines `Win32_Battery` with the read-only `root/wmi`
capacity and cycle-count classes when those classes are present; absent classes
remain unavailable rather than being inferred.
Fan RPM is read-only evidence from Linux hwmon or Windows `Win32_Fan` when
available. macOS fan evidence remains unavailable; no platform path writes
firmware registers or changes fan profiles.
Known exact process names are classified as `developer`, `runtime`, or `model`
for workload policy and process explanations; unrecognized names remain
`unknown` and are never treated as safe or protected by guesswork.
Missing sensors and unsupported platforms remain `available: false`; no
telemetry path grants process-stop, startup-disable, file-delete, or
network-control authority.

The download guard provides explicit preflight, bounded scanning, incomplete
download review, duplicate groups, and SHA-256 verification. It requires an
explicit root or volume fact set, does not start or intercept downloads, and
does not move or delete files.

Storage Pressure Guard package-cache roots include explicit npm, pip, Yarn,
pnpm, and Cargo cache locations when present. Browser automation cache roots
cover Puppeteer, Selenium, and Playwright generated-cache locations. These
roots remain category-allow-listed, age-bounded, and protected by the same
preview and approval boundary.

`download-monitor` compares bounded scans of an explicit root and reports
active, stalled, incomplete, and completed entries with measured byte rate. It
also attaches current Storage Pressure Guard evidence and returns
`download-filling-volume` when measured growth coincides with critical or
emergency free-space pressure. It is trigger-based observation only; it does
not intercept downloads or change destination, bandwidth, or file state.

`media-player --action play --tracks ... --confirm` uses the selected local
track from the deterministic queue and delegates only to the fixed platform
default-player opener. Without confirmation it returns a preview or approval
result; the optimizer does not embed a decoder or claim control over external
player state.

`network-overview` combines interface facts with optional explicit per-process
rates, observed connection ownership, and latency to identify gaming/download
contention. Per-process
bandwidth remains unavailable when the host does not provide counters, and no
network throttle is claimed or applied.

Workstation facts also include fixed read-only connection evidence from
Windows `Get-NetTCPConnection`, Linux `ss`, or macOS `lsof` when available.
Each row carries PID, endpoint, protocol, and state context. This helps explain
which workload owns an active connection, but it does not become a byte-rate
measurement or authorize traffic shaping.

`network-monitor` provides a reusable trigger loop around a caller-owned
platform sampler. It emits stable, started, continued, and stopped contention
events, preserves the sample source, and remains observation-only. It does not
intercept traffic or claim bandwidth enforcement.

`network-rate-monitor` derives interface receive/send rates from consecutive
platform counters. The first sample, missing counters, and counter resets stay
explicitly unavailable. Interface rates do not identify a process; per-process
bandwidth remains available only when the host supplies that evidence.

`process-rate-monitor` derives bounded CPU, read/write I/O, memory-delta, and
observed GPU-memory evidence for matching process identities from consecutive
fact samples. New PIDs, changed executable identities, missing counters, and
counter resets remain explicit instead of becoming guessed rates. It is
observation-only and does not start, stop, reprioritize, or limit processes.

`file-inspect` scans one explicit root for incomplete downloads, stale
installers, large files, models, archives, ISO files, protected paths, and
hash-backed duplicate groups. It returns a review-only plan; `organize-preview`
and `placement-preview` remain the only move previews, and no file-insights
command mutates the filesystem. Organizer preview/apply accepts
`--protected-root` and preserves those roots even when the selected organizer
root contains them.

The media library provides a bounded read-only catalogue for local audio,
video, and image files, plus explicit favorites, recently played entries,
playlists, import/export, and a player-host handoff plan. It skips symlinks,
limits depth and entries, optionally hashes within a byte budget, and stores
only metadata in a caller-selected state file. It does not play, move, copy,
download, or delete media; an application-owned player host remains required
for playback.

`media-player` provides deterministic queue, play/pause, previous/next,
shuffle, repeat, select, and search state for an application-owned player
host. `media-play` validates one exact existing local media file and invokes
only the fixed platform default-player opener after confirmation. It uses the
shell-free command runner and refuses remote URLs, symlinks, and non-media
extensions. `media-panel` accepts only HTTPS URLs on its explicit allow-list
and returns an approval-gated embed plan; it does not fetch or download media.
`media-panel-open` can open the approved URL in the fixed platform default
browser after confirmation, without arbitrary URL execution or downloads.

`media-metadata` uses one fixed, shell-free `ffprobe` call to collect bounded
duration, format, codec, audio-channel, and video-dimension facts. Missing
`ffprobe`, invalid output, symlinks, and unsupported files stay unavailable.
The local media player applies queue navigation, shuffle, repeat, search, and
playlist state locally; actual decoding and playback remain with the approved
player host.

`workload-preview` detects declared game evidence, a foreground process with
an explicit game role, a process whose observed executable path is inside a
Steam `steamapps/common` game root, or a caller-supplied exact process name.
The trusted-path rule is deliberately narrow and never grants mutation
authority by itself. On
Windows, process telemetry also marks the current desktop foreground PID via
the fixed user32 `GetForegroundWindow` and `GetWindowThreadProcessId` calls;
other platforms retain explicit caller/platform evidence and fail closed when
foreground state is unavailable. It plans
low/normal process and I/O priorities only for non-foreground, non-protected,
non-system background PIDs. `workload-apply` requires `--confirm` and an
explicit `--approve-pids` list. The Linux adapter can apply both priority
types; Windows currently reports I/O priority as unsupported. Linux CPU limits
use a dedicated cgroup-v2 group when the host exposes the CPU controller, and
Linux memory limits use a dedicated cgroup-v2 `memory.max` group when the
memory controller is available, otherwise the bounded `prlimit` address-space
fallback; macOS hard resource limits remain explicit
unsupported results. CPU and memory hard limits are available through the
separate resource-limit authority when the adapter proves support. GPU hard
caps remain unsupported, and the governor does not claim an exact restore
without pre-change priority evidence.

`workload-budget-preview` compares explicit CPU, memory, I/O, and GPU limits
with observed process facts. The default priority mode can lower process and
supported I/O priority for explicitly approved background PIDs. Pass `--hard`
to route bounded CPU and memory breaches through the existing resource-limit
authority. On Linux, a hard `ioBytesPerSecond` budget is enforceable only when
the budget also supplies an observed block-device `ioDevice` such as `8:0`;
the adapter writes a cgroup-v2 `io.max` rule. Windows and macOS return explicit
unsupported I/O byte-rate results, and GPU hard caps remain unsupported.

`game-session-monitor` watches explicit game process evidence on a trigger
interval. It can apply only approved background priority/I/O operations when
`--auto-apply --confirm` and `--approve-pids` are supplied. Session exit
restoration uses exact captured priority evidence; without it, the result is
review-required. It does not automatically impose hard resource limits; use
the separate resource-limit authority for approved CPU or memory caps. GPU and
network caps remain unsupported.

`drive-health` inventories physical drives with fixed platform commands. Windows
uses `Get-PhysicalDisk`, Linux uses `lsblk`, and macOS uses `diskutil list`.
The optional `--smart-device` probe invokes only the read-only `smartctl -H -A`
path after strict device-path validation. `--smart-all` is an explicit bounded
probe over at most 32 device paths already returned by the inventory; it
normalizes only simple platform device names, de-duplicates them, and never
scans arbitrary paths. Both modes report available temperature, percentage-used,
power-on-hour, unsafe-shutdown, and critical-warning attributes. Missing
`smartctl`, unsupported devices, attributes, and command failures remain
unavailable. Normal facts collection remains inventory-only and never invokes
SMART probing implicitly.

`volume-storage` inventories mounted volumes with fixed read-only commands.
Windows uses `Get-Volume`; Linux and macOS use `df`. It reports mount, device,
filesystem, total, free, used, health, and read-only evidence without treating
an unavailable volume as healthy or selecting a placement destination.

`drive-benchmark` writes one bounded temporary sample under an explicit root,
reads it back, verifies the byte count, reports write/read throughput, and
removes only its own sample. It is evidence, not a claim of sustained device
performance.

`placement-preview` accepts explicit file facts and an explicit source root,
target root, protected-root list, and target free-space measurement. It never
scans by size or moves files during preview. `placement-apply` requires
`--confirm`; same-volume moves use rename, while cross-volume moves use
copy-verify-delete and preserve the source if verification fails.

`placement-policy-preview` consumes a prior file-insights scan and an explicit
category-to-target map, then creates one bounded plan per target volume.
Protected, incomplete, duplicate, unclassified, and missing-evidence entries
remain skipped. Apply and rollback delegate to the existing placement authority.

`placement-recommend` consumes explicit mounted-volume free-space and SSD/HDD
evidence. It recommends capacity media for models, archives, ISOs, and
installers, refuses unknown or degraded/protected/read-only volumes, and never
creates a move plan or mutates a file.

`assistant` is a deterministic local facts-to-plan interface. It answers
supported storage, memory/pagefile, CPU/GPU thermal, battery, history, daily-priority,
workload, and placement questions from supplied or locally collected facts. It
refuses unknown operations and never turns natural-language text into a
command.

`policy-preview` combines local facts into bounded storage, memory/pagefile,
thermal, gaming/build, battery, and process handoffs. `policy-approve` marks
only exact recommendation IDs as approved; both commands remain non-mutating.
The named authority still owns the delegated preview/apply action, and the
audited native path owns before/after verification.
`power-preview` and `power-apply` expose named cross-platform profiles. They
map to fixed documented adapter values and require confirmation for mutation;
fan curves, firmware registers, and unsupported platform controls remain
unavailable.

`power-monitor` watches facts on a trigger interval and reports profile
observed, continued, and changed events. It can apply only the documented
profile mapping when `--auto-apply --confirm` is supplied; unsupported
platforms and adapter failures remain visible in the report.

`process-overview` joins bounded process and startup facts with role, usage,
runtime, and stop-impact explanations. Stop preview selects an exact observed
PID and refuses protected or foreground processes. Stop apply requires
confirmation, an approved background PID, and any platform-required admin
boundary.

`startup-preview` and `startup-apply` select one exact observed startup entry.
Linux and macOS user startup files use an optimizer-owned `.rnk-disabled`
suffix with a restore receipt. Windows accepts only the documented HKCU/HKLM
Run registry locations and removes one named value with a restore receipt.
Unknown locations, symlinks, protected names, occupied restore paths, and
unsupported platforms refuse. `startup-restore` requires explicit confirmation.

Supplying `--history-path` to `optimize` wraps the native authority with an
append-only audit sequence: bounded observation, plan preview, apply report,
and post-action verification. If the preview cannot be recorded, the native
action is not attempted. The audit layer does not claim reversibility unless a
separate authority supplies an undo record.
