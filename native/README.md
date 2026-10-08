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
node native/cli.mjs cache-clean --target user-temp --confirm
node native/cli.mjs storage-preview --target-free-gb 5 \
  --enable=temporary-files,package-cache,browser-automation-cache,gpu-shader-cache
node native/cli.mjs storage-cleanup --target-free-gb 5 \
  --enable=temporary-files,package-cache --confirm
node native/cli.mjs storage-monitor --target-free-gb 5 \
  --enable=temporary-files,package-cache --interval-seconds 60
node native/cli.mjs organize-preview --root "$HOME/Downloads"
node native/cli.mjs organize-apply --root "$HOME/Downloads" --confirm
node native/cli.mjs download-preflight --size-bytes 12800000000 \
  --destination C: --volumes '[{"mount":"C:","freeBytes":8000000000},{"mount":"E:","freeBytes":100000000000}]'
node native/cli.mjs download-scan --root "$HOME/Downloads" --hash-files
node native/cli.mjs download-verify --file "$HOME/Downloads/file.zip" --sha256 HASH
node native/cli.mjs download-monitor --root "$HOME/Downloads" --interval-seconds 30
node native/cli.mjs steward-report --path "$HOME/.rnk-optimizer/history.jsonl" \
  --window-hours 24 --max-samples 96
node native/cli.mjs steward-schedule --path "$HOME/.rnk-optimizer/history.jsonl" \
  --interval-seconds 900
node native/cli.mjs steward-trends --path "$HOME/.rnk-optimizer/history.jsonl" \
  --window-days 30 --max-entries 512
node native/cli.mjs workload-preview --mode gaming-build --game-names game.exe \
  --background-pids 1234,5678
node native/cli.mjs workload-apply --mode gaming-build --game-names game.exe \
  --approve-pids 1234 --confirm
node native/cli.mjs workload-budget-preview --budget '{"cpuPercent":50}' \
  --target-pids 1234,5678
node native/cli.mjs workload-budget-apply --budget '{"cpuPercent":50}' \
  --target-pids 1234 --approve-pids 1234 --confirm
node native/cli.mjs drive-health
node native/cli.mjs drive-health --smart-device /dev/nvme0n1
node native/cli.mjs drive-benchmark --root "$HOME/.cache"
node native/cli.mjs network-overview --game-pid 1234 --latency-ms 80 \
  --samples '[{"pid":1234,"role":"game","receivedBytesPerSecond":1000}]'
node native/cli.mjs placement-preview --source-root "$HOME/Downloads" \
  --target-root /mnt/archive --target-free-bytes 100000000000 \
  --files '[{"path":"/home/me/Downloads/model.zip","sizeBytes":12000000000,"category":"models"}]'
node native/cli.mjs placement-apply --source-root "$HOME/Downloads" \
  --target-root /mnt/archive --target-free-bytes 100000000000 \
  --files '[{"path":"/home/me/Downloads/model.zip","sizeBytes":12000000000,"category":"models"}]' --confirm
node native/cli.mjs assistant --question "Why is my C: drive full?"
node native/cli.mjs power-recommend
node native/cli.mjs power-preview --profile gaming
node native/cli.mjs power-apply --profile gaming --confirm
node native/cli.mjs process-overview --max-entries 128
node native/cli.mjs process-stop-preview --pid 1234
node native/cli.mjs process-stop-apply --pid 1234 --confirm --allow-admin
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

Supported controls are Windows power profile/process priority and Linux power
profile/process priority/process I/O priority. GPU policy, CPU affinity, and
memory policy remain explicit unsupported results until safe implementations
are added. NVIDIA facts are observational only.

The `user-temp` target is optimizer-owned. D3D, NVIDIA, and Mesa shader
caches are platform/driver-generated; the optimizer exposes only fixed,
explicit preview targets and does not claim ownership of those files.

## Storage Pressure Guard

`storage-preview` reads the system drive and reports `normal`, `warning`,
`critical`, or `emergency` pressure. The default target is 5 GiB free and
the default age boundary is 24 hours. Both the pressure thresholds and target
floor are configurable. The Windows collector reports pagefile allocation and
usage separately; `pagefile.sys`, `hiberfil.sys`, and `swapfile.sys` are never
cleanup targets.

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
and measured before/after free-space recovery.

The workstation steward also exposes an append-only history store and a
cross-platform observation monitor. `steward-history` supports read, append,
rollback-preview, and quarantine-preview operations; `steward-monitor` records
periodic steward reports and delivers them to stdout. `steward-report` reduces
the retained facts into a daily report with storage, memory, CPU/GPU, thermal,
battery, pagefile, process, network, workload, gaming, and cleanup evidence.
Missing sensors remain missing. Neither command applies the planner's actions
automatically.

`steward-schedule` delivers one report per UTC day while its trigger loop is
running. It writes through a caller-owned delivery callback and does not install
an operating-system task or claim background service persistence.

`steward-trends` reduces retained reports over a bounded multi-day window and
reports storage fill rate, battery-health movement, thermal movement,
memory-pressure movement, drive-failure evidence, and recommendations.

`collectSystemFacts()` now includes bounded process, startup, battery, thermal,
and network telemetry when the host exposes it. Windows uses fixed PowerShell
queries, Linux uses fixed `ps` plus read-only `/sys`, `/proc`, and startup
roots, and macOS uses fixed `ps`, `pmset`, `netstat`, and startup roots.
Missing sensors and unsupported platforms remain `available: false`; no
telemetry path grants process-stop, startup-disable, file-delete, or
network-control authority.

The download guard provides explicit preflight, bounded scanning, incomplete
download review, duplicate groups, and SHA-256 verification. It requires an
explicit root or volume fact set, does not start or intercept downloads, and
does not move or delete files.

`download-monitor` compares bounded scans of an explicit root and reports
active, stalled, incomplete, and completed entries with measured byte rate.
It is trigger-based observation only; it does not intercept downloads or
change destination, bandwidth, or file state.

`network-overview` combines interface facts with optional explicit per-process
rates and latency to identify gaming/download contention. Per-process
bandwidth remains unavailable when the host does not provide counters, and no
network throttle is claimed or applied.

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

`workload-preview` detects only declared game evidence, a foreground process
with an explicit game role, or a caller-supplied exact process name. It plans
low/normal process and I/O priorities only for non-foreground, non-protected,
non-system background PIDs. `workload-apply` requires `--confirm` and an
explicit `--approve-pids` list. The Linux adapter can apply both priority
types; Windows currently reports I/O priority as unsupported. CPU, memory, and
GPU hard caps remain explicit unsupported dimensions, and the governor does
not claim an exact restore without pre-change priority evidence.

`workload-budget-preview` compares explicit CPU, memory, I/O, and GPU limits
with observed process facts. Apply can lower process priority and supported
I/O priority for explicitly approved background PIDs. Memory and GPU hard caps
remain unsupported; a plan never claims those dimensions were enforced.

`drive-health` inventories physical drives with fixed platform commands. Windows
uses `Get-PhysicalDisk`, Linux uses `lsblk`, and macOS uses `diskutil list`.
The optional `--smart-device` probe invokes only `smartctl -H` after strict
device-path validation. Inventory metadata is not SMART proof; missing
`smartctl`, unsupported devices, and command failures are reported as
unavailable.

`drive-benchmark` writes one bounded temporary sample under an explicit root,
reads it back, verifies the byte count, reports write/read throughput, and
removes only its own sample. It is evidence, not a claim of sustained device
performance.

`placement-preview` accepts explicit file facts and an explicit source root,
target root, protected-root list, and target free-space measurement. It never
scans by size or moves files during preview. `placement-apply` requires
`--confirm`; same-volume moves use rename, while cross-volume moves use
copy-verify-delete and preserve the source if verification fails.

`assistant` is a deterministic local facts-to-plan interface. It answers
supported storage, memory/pagefile, thermal, battery, history, daily-priority,
workload, and placement questions from supplied or locally collected facts. It
refuses unknown operations and never turns natural-language text into a
command.
`power-preview` and `power-apply` expose named cross-platform profiles. They
map to fixed documented adapter values and require confirmation for mutation;
fan curves, firmware registers, and unsupported platform controls remain
unavailable.

`process-overview` joins bounded process and startup facts with role, usage,
runtime, and stop-impact explanations. Stop preview selects an exact observed
PID and refuses protected or foreground processes. Stop apply requires
confirmation, an approved background PID, and any platform-required admin
boundary; startup changes remain review-only.

Supplying `--history-path` to `optimize` wraps the native authority with an
append-only audit sequence: bounded observation, plan preview, apply report,
and post-action verification. If the preview cannot be recorded, the native
action is not attempted. The audit layer does not claim reversibility unless a
separate authority supplies an undo record.
