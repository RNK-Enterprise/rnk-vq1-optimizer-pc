# RNK Vortex System Optimizer

This repository is the public PC optimizer release. It contains native
Windows/Linux/macOS action authority, a cross-platform facts layer for Windows,
Linux, and macOS where supported, a browser-owned local media host, and the PC
analysis engine tree. The native agent measures the host and applies only
bounded, locally validated actions.

## Safety model

Installation requires an explicit environment choice:

- `headless` is CLI-first and does not assume a desktop session.
- `interactive` permits desktop-oriented control with the same preview and
  approval boundaries.

Installation does not change the operating system. `facts` is read-only.
`optimize` requests a bounded data-only plan and previews it by default.
Applying a plan, administrative actions, cache deletion, and file
organization are separate explicit operations.

The native agent does not sweep arbitrary directories, alter user files,
install undocumented tweaks, manipulate packets, or change network
configuration. File organization is a separate preview/confirm workflow and
never overwrites an existing destination.

## Workstation steward policy layer

The `workstation-steward` engine is the cross-platform policy layer for the
broader workstation workflow. It accepts the same bounded evidence schema on
Windows, Linux, and macOS and produces reviewable plans for:

- foreground-game detection, developer/build coexistence, process and startup
  explanations, and resource budgets;
- SMART/health and read/write benchmark evidence, duplicate and incomplete-file
  review, protected-path checks, download placement, and move previews;
- storage, memory, battery, thermal, cleanup, network, workload, and gaming
  trends for a daily report;
- local media and music catalogues, playlists, favorites, approved HTTPS
  media-panel references, fixed workstation questions, and reversible action
  receipts.

The policy layer is facts-to-plan only. It does not claim that a budget was
enforced, a file was moved, a report was scheduled, or media was downloaded.
Those outcomes require an explicit platform authority, approval, verification,
and (where applicable) a caller-owned append-only history store.

The browser PC surface also includes an application-owned local music host in
`scripts/pc-media-player.js`. It plays only user-selected local `File`/`Blob`
objects through `HTMLAudioElement`, with bounded queue/shuffle/repeat controls
and object-URL cleanup. Remote URLs and downloads are outside that authority.

The source-level wishlist closure and the remaining product/certification
boundaries are tracked in [`STATUS.md`](STATUS.md).

## Supported native controls

The current platform adapters provide documented controls for:

- Windows power profile, process priority, bounded process affinity, approved
  Job Object CPU/memory limits, ROG host evidence, and per-process NetQos
  traffic shaping with shipped IPv4 TCP EStats byte evidence.
- Linux power profile, process priority, process I/O priority, bounded process
  affinity, approved cgroup-v2 CPU/memory limits with an explicit address-space
  fallback when Linux memory control is unavailable, and approved cgroup-v2
  `io.max` byte-rate limits when block-device evidence is supplied.
- macOS process priority, bounded cache cleanup, approved process stop, and
  launchd hard CPU/RAM limits for future jobs.
- Optimizer-owned temporary-cache preview and explicit cleanup.
- Storage Pressure Guard for bounded system-drive monitoring, preview, and
  explicitly approved cleanup of regenerable categories.
- Read-only CPU, memory, storage, process, startup, battery, thermal, fan, network,
  and optional NVIDIA facts. Process, battery, thermal, fan, and network telemetry
  returns explicit unavailable evidence when the platform or sensor does not
  provide it.

Universal FPS control requires an observed named controller backend. NVIDIA
power caps are bounded where the host exposes current/minimum/maximum limits;
other vendor power caps remain explicit unsupported results. Windows resource
limits use a fixed Job Object authority. Linux uses cgroup-v2 `cpu.max` and
`memory.max` when controllers are available, with `prlimit` as the explicit
address-space fallback for unavailable memory control; neither platform claims
a portable GPU cap. CPU affinity is supported only through fixed
balanced/performance masks for explicitly approved processes. NVIDIA facts are
observational unless an approved bounded power-cap operation is explicitly
applied. The
browser media host under `scripts/pc-media-player.js` does not execute
operating-system commands.

## Install from an immutable release

Linux:

```bash
./install/linux/install.sh --mode interactive --ref v3.1.1
```

Windows PowerShell:

```powershell
.\install\windows\install.ps1 -EnvironmentMode interactive -Ref v3.1.1
```

Both installers require Git, npm, and Node.js 20 or newer. They require an
annotated release tag or full commit SHA, verify the checked-out commit, run
`npm ci`, save the environment mode outside the checkout, and collect
read-only facts. Floating branch installation is rejected.

To request an optimization preview during installation, provide the gateway
explicitly. Remote gateways must use HTTPS; HTTP is accepted only for
loopback development endpoints:

```bash
./install/linux/install.sh --mode headless --ref v3.1.1 --run-optimize \
  --gateway https://optimizer.example.invalid/v1/plan
```

The equivalent Windows option is `-RunOptimize -GatewayUrl URL`. The gateway
URL may also be supplied through `OPTIMIZER_GATEWAY_URL`. The installer stops
before cloning when optimization was requested without a gateway.

## CLI

```bash
node native/cli.mjs facts
node native/cli.mjs optimize --gateway URL
node native/cli.mjs optimize --gateway URL --apply --approve=clear-cache
node native/cli.mjs optimize --gateway URL --apply --allow-admin
node native/cli.mjs optimize --gateway URL --history-path \
  "$HOME/.rnk-optimizer/history.jsonl"
node native/cli.mjs cache-preview --target user-temp --max-age-hours 24
node native/cli.mjs cache-clean --target user-temp --confirm
node native/cli.mjs storage-preview --target-free-gb 5 \
  --enable=temporary-files,package-cache,browser-automation-cache,gpu-shader-cache
node native/cli.mjs storage-cleanup --target-free-gb 5 \
  --enable=temporary-files,package-cache --confirm
node native/cli.mjs storage-monitor --target-free-gb 5 \
  --enable=temporary-files,package-cache --interval-seconds 60 \
  --growth-window-hours 720 --growth-threshold-bytes 1048576
node native/cli.mjs steward-history --path "$HOME/.rnk-optimizer/history.jsonl"
node native/cli.mjs steward-history --path "$HOME/.rnk-optimizer/history.jsonl" \
  --append '{"id":"preview-1","event":"preview","timestamp":0}'
node native/cli.mjs steward-monitor --path "$HOME/.rnk-optimizer/history.jsonl" \
  --interval-seconds 900
node native/cli.mjs steward-report --path "$HOME/.rnk-optimizer/history.jsonl" \
  --window-hours 24 --max-samples 96
node native/cli.mjs steward-schedule --path "$HOME/.rnk-optimizer/history.jsonl" \
  --interval-seconds 900
node native/cli.mjs report-schedule-preview --path "$HOME/.rnk-optimizer/history.jsonl" \
  --output-path "$HOME/.rnk-optimizer/daily-report.json" --time 09:00
node native/cli.mjs report-schedule-apply --path "$HOME/.rnk-optimizer/history.jsonl" \
  --output-path "$HOME/.rnk-optimizer/daily-report.json" --time 09:00 --confirm
node native/cli.mjs steward-daemon --path "$HOME/.rnk-optimizer/history.jsonl" \
  --observation-interval-seconds 900 --report-interval-seconds 900
node native/cli.mjs steward-trends --path "$HOME/.rnk-optimizer/history.jsonl" \
  --window-days 30 --max-entries 512
node native/cli.mjs workload-preview --mode gaming-build --game-names game.exe \
  --background-pids 1234,5678
node native/cli.mjs workload-apply --mode gaming-build --game-names game.exe \
  --approve-pids 1234 --confirm
node native/cli.mjs workload-budget-preview --budget \
  '{"cpuPercent":50,"memoryBytes":8589934592,"ioBytesPerSecond":52428800,"ioDevice":"8:0","gpuPercent":35}' \
  --target-pids 1234,5678
node native/cli.mjs workload-budget-apply --budget '{"cpuPercent":50}' \
  --target-pids 1234 --approve-pids 1234 --confirm
node native/cli.mjs resource-limit-preview --limits \
  '{"cpuPercent":50,"memoryBytes":8589934592}' --target-pids 1234
node native/cli.mjs resource-limit-apply --limits \
  '{"cpuPercent":50,"memoryBytes":8589934592}' --target-pids 1234 \
  --approve-pids 1234 --allow-admin --confirm
node native/cli.mjs gpu-policy-preview --policy balanced
node native/cli.mjs gpu-policy-apply --policy battery --allow-admin --confirm
node native/cli.mjs game-session-monitor --game-names game.exe \
  --background-pids 1234,5678 --interval-seconds 10
node native/cli.mjs game-session-monitor --game-names game.exe \
  --background-pids 1234 --approve-pids 1234 --auto-apply --confirm
node native/cli.mjs drive-health
node native/cli.mjs drive-health --smart-device /dev/nvme0n1
node native/cli.mjs filesystem-health --root /
node native/cli.mjs drive-benchmark --root "$HOME/.cache"
node native/cli.mjs network-overview --game-pid 1234 --latency-ms 80 \
  --samples '[{"pid":1234,"role":"game","receivedBytesPerSecond":1000}]'
node native/cli.mjs process-rate-monitor --interval-seconds 5
node native/cli.mjs network-monitor --game-pid 1234 --latency-ms 80 \
  --interval-seconds 5 --download-threshold-bytes-per-second 1048576
# Equivalent package command: npm run native:network:contention -- --game-pid 1234
node native/cli.mjs file-inspect --root "$HOME/Downloads" \
  --target-root /mnt/archive --hash-files --protected-root "$HOME/projects"
node native/cli.mjs placement-preview --source-root "$HOME/Downloads" \
  --target-root /mnt/archive --target-free-bytes 100000000000 \
  --files '[{"path":"/home/me/Downloads/model.zip","sizeBytes":12000000000,"category":"models"}]'
node native/cli.mjs placement-apply --source-root "$HOME/Downloads" \
  --target-root /mnt/archive --target-free-bytes 100000000000 \
  --files '[{"path":"/home/me/Downloads/model.zip","sizeBytes":12000000000,"category":"models"}]' --confirm
node native/cli.mjs placement-policy-preview --scan '{"root":"/home/me/Downloads","entries":[],"duplicates":[]}' \
  --target-roots '{"model":"/mnt/archive/models","archive":"/mnt/archive/archives"}' \
  --target-free-bytes '{"/mnt/archive/models":100000000000,"/mnt/archive/archives":100000000000}'
node native/cli.mjs assistant --question "Why is my C: drive full?"
node native/cli.mjs power-recommend
node native/cli.mjs power-preview --profile gaming
node native/cli.mjs power-apply --profile gaming --confirm
node native/cli.mjs power-monitor --interval-seconds 300
node native/cli.mjs power-monitor --auto-apply --confirm --allow-admin
node native/cli.mjs process-overview --max-entries 128
node native/cli.mjs process-stop-preview --pid 1234
node native/cli.mjs process-stop-apply --pid 1234 --confirm --allow-admin
node native/cli.mjs startup-preview --name Updater \
  --location 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
node native/cli.mjs startup-apply --name Updater \
  --location 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' --confirm
node native/cli.mjs download-preflight --size-bytes 12800000000 \
  --destination C: --volumes '[{"mount":"C:","freeBytes":8000000000},{"mount":"E:","freeBytes":100000000000}]'
node native/cli.mjs download-scan --root "$HOME/Downloads" --hash-files
node native/cli.mjs download-verify --file "$HOME/Downloads/file.zip" --sha256 HASH
node native/cli.mjs download-monitor --root "$HOME/Downloads" \
  --target-free-gb 5 --interval-seconds 30
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
node native/cli.mjs organize-preview --root "$HOME/Downloads" \
  --protected-root "$HOME/projects,$HOME/models,$HOME/.ssh"
node native/cli.mjs organize-apply --root "$HOME/Downloads" \
  --protected-root "$HOME/projects,$HOME/models,$HOME/.ssh" --confirm
```

The gateway supplies bounded data. The native adapter validates the protocol,
action allow-list, numeric limits, expiry, approvals, and admin boundary
before any action can run. No arbitrary command or setting path is accepted.

Storage Pressure Guard monitors the system drive while `storage-monitor` is
running. It classifies `normal`, `warning`, `critical`, and `emergency`
pressure using configurable thresholds and a target free-space floor. Warning
and higher events include a bounded reclaimable-space preview. `--auto-clean`
is opt-in and only acts on explicitly enabled safe categories. Windows Update
downloads and abandoned runtime remnants require separate approval and are not
automatic-cleanup targets. Pagefiles, active runtimes, models, projects,
repositories, credentials, WSL data, user files, and system-managed files are
never cleanup targets.

The guard distinguishes platform/driver shader caches from optimizer-owned
temporary files, reports pagefile pressure separately, previews exact paths and
byte counts, and records removed bytes plus measured post-cleanup recovery. It
never recursively deletes a directory because it is large.
Linux and macOS system-drive pressure use fixed read-only `df` collectors;
Windows pagefile evidence remains separate from reclaimable storage.

Multiple abandoned-runtime roots can be supplied explicitly as a comma-separated
`--abandoned-root PATH1,PATH2` value; the category remains approval-gated.

The live storage monitor also retains bounded in-process growth evidence. Its
output identifies falling free space and reclaimable categories whose observed
bytes are increasing; this does not add scan, move, or delete authority.

The native media library is a bounded, cross-platform catalogue for local
audio, video, and image files. It supports duplicate evidence, favorites,
recently played entries, playlists, import/export, and an explicit
player-host handoff plan. It never plays, downloads, moves, copies, or deletes
media; actual playback remains an application-owned host responsibility.

The media player state machine supplies queue selection, play/pause, previous/
next, shuffle, repeat, search, and host handoff state. `media-play` validates
one exact existing local media file and opens it with the fixed platform
default-player command after `--confirm`; it uses no shell and accepts no
remote URL. The media panel accepts only HTTPS URLs on an explicit allow-list
and produces an approval-gated embed plan; it never fetches media or bypasses
service restrictions. `media-panel-open` can open an approved panel URL in the
fixed platform default browser after confirmation; it does not download or
embed arbitrary content.

`media-metadata` reads bounded duration, format, codec, audio-channel, and
video-dimension evidence from one exact local media file through `ffprobe`.
Missing `ffprobe`, invalid output, symlinks, and unsupported files remain
explicitly unavailable.

`steward-report` reduces the bounded facts retained by `steward-monitor` into a
daily workstation report. It reports observed storage/free-space movement,
memory and pagefile pressure, CPU/GPU load, thermals and throttling, battery
condition, abnormal processes, network counters, development/gaming
contention, and cleanup evidence. It reports unavailable dimensions as missing
evidence and never infers health from silence.

`steward-snapshot --path PATH` collects one fresh workstation observation,
appends it to the caller-owned history, and immediately emits the resulting
daily report. Add `--output-path PATH --format json|markdown|html` to persist
the report without starting a long-running monitor or daemon.

`steward-schedule` delivers at most one report per UTC day through a
caller-owned callback (the CLI writes JSON lines to stdout). It is trigger-based
and remains active only while the command is running. The separate
`report-schedule-preview`/`report-schedule-apply` authority installs an explicit
user-level Windows Task Scheduler task, Linux systemd user timer, or macOS
launchd agent; restore consumes its receipt and no privileged service is used.

Use `--output-path PATH --format json|markdown|html` with `steward-schedule`, or
`--report-output-path PATH --format json|markdown|html` with `steward-daemon`, to
persist the daily report as a bounded local artifact. HTML is a self-contained
browser-readable dashboard with escaped report data. No external delivery is
performed. The dashboard includes the current storage-volume table and
per-drive device/model/media/health evidence, network rates/connections, development and gaming
contention, CPU/GPU load, pagefile pressure, battery, thermal, abnormal-process,
cleanup, and policy evidence; missing evidence remains
explicitly unknown.

Use `node native/cli.mjs report-open --path PATH --confirm` to open one explicit
local HTML report through the fixed platform default opener. The command does
not serve files, fetch URLs, or execute arbitrary commands.

`steward-daemon` combines the observation and daily-report loops in one
long-running process. It records bounded facts, emits daily reports, and stops
cleanly on process signals. It does not install an operating-system service,
tray process, scheduler task, or privileged daemon; lifecycle ownership remains
with the host application.

`steward-trends` reduces the same caller-owned history over a bounded
multi-day window and reports storage fill rate, battery-health movement,
thermal movement, memory-pressure movement, drive-failure evidence, and
recommendations. Missing samples remain unknown.

`network-monitor` adds trigger-based contention history around an explicit
platform or caller per-process sampler. The CLI exposes the same authority
through `network-monitor`; it reports gaming/download contention transitions and
never claims to enforce a network budget or shape traffic.

`process-rate-monitor` derives bounded CPU, read/write I/O, memory-delta, and
observed GPU-memory evidence for matching process identities from consecutive
fact samples. New PIDs, changed executable identities, missing counters, and
counter resets remain explicit instead of becoming guessed rates. It is
observation-only and does not start, stop, reprioritize, or limit processes.

`file-inspect` provides bounded read-only evidence for incomplete downloads,
stale installers, large files, models, archives, ISO files, protected paths,
and hash-backed duplicate groups. Its plan never mutates the filesystem; use
the existing organizer or placement preview before approving a move.

The workload governor connects gaming/build coexistence policy to the native
priority authority. It detects only explicit game evidence, excludes protected
and system processes, previews exact PID operations, and requires explicit
approval before applying them. Hard CPU and RAM limits are delegated to the
separate platform resource-limit authority where the adapter proves support. The
bounded GPU policy authority can apply an approved NVIDIA power limit on
supported Windows/Linux hosts when current, minimum, and maximum watt evidence
is present; universal FPS control requires an observed named controller backend,
and non-NVIDIA caps remain unsupported.

`workload-budget-preview` compares explicit per-process CPU, memory, I/O, and
GPU limits with observed facts. `workload-budget-apply` can apply only the
supported soft responses—lower process priority and, on Linux, lower I/O
priority—to explicitly approved background PIDs. Hard CPU and memory limits
use the existing resource-limit authority. Linux hard I/O byte-rate limits
require an observed `ioDevice` major:minor pair and use cgroup-v2 `io.max`;
Windows and macOS report that dimension as unsupported. GPU percentage caps
remain unsupported evidence, while FPS plans refuse to apply without a named
host controller.

`resource-limit-preview` and `resource-limit-apply` are the separate hard-limit
authority for approved background PIDs. Windows applies CPU and per-process
memory limits through a fixed Job Object script. Linux applies CPU through
`cpu.max` and memory through `memory.max` when available, with an explicit
`prlimit` address-space fallback for unavailable memory control; macOS limits
refuse explicitly. These operations require `--confirm`, approved PIDs, and the
platform's administrative boundary. A hard limit is not reversible through a
generic rollback because the operating system owns its lifetime; the process
must be reconfigured or restarted after review.

`game-session-monitor` is a trigger-based gaming-session supervisor. Windows
process telemetry supplies the current desktop foreground PID through fixed
user32 calls; Linux and macOS require explicit foreground evidence from the
platform adapter or caller. It detects an explicitly named or role-labelled
foreground game, previews background
priority/I/O reductions, and can opt into approved-PID application. On session
exit it restores only priority values captured before application; missing
pre-change evidence remains review-required. It does not impose hard CPU,
memory, GPU, or network caps.

`drive-health` provides cross-platform physical-drive inventory and explicit
SSD/HDD classification. Its optional SMART probe is separate and uses strict
device validation. It reports SMART health plus available temperature,
percentage-used, power-on-hour, unsafe-shutdown, and critical-warning
attributes. Missing attributes or tooling remain unavailable rather than being
treated as healthy.

`filesystem-health` performs a separate read-only filesystem check for one
explicit root. Windows uses `Get-Volume`, Linux uses `findmnt`, and macOS uses
`diskutil info`; unsupported checkers and malformed results remain unavailable.

Cross-volume placement is a separate explicit workflow. The preview requires
caller-supplied file facts, source and target roots, protected roots, and free
space. Apply requires confirmation, verifies cross-volume copies before source
deletion, and exposes rollback evidence; it never sweeps arbitrary large
directories.

`placement-policy-preview` consumes a prior file-insights scan and an explicit
category-to-target map. It skips protected, incomplete, duplicate, unclassified,
and missing-evidence entries, then emits one bounded placement plan per target
volume. `placement-policy-apply` delegates to the same copy-verify-delete
authority and `placement-policy-rollback` delegates to its receipts; it never
invents a destination from file size or recursively moves a directory.

The local workstation assistant is deterministic and facts-only. It answers
storage, memory/pagefile, thermal, battery, history, daily-priority, workload,
and placement questions, but never executes natural-language commands. Cleanup
and placement responses are preview plans that retain the existing approval
boundaries.
An optional caller-owned language adapter may translate a bounded JSON response
into a canonical question; the deterministic assistant remains the authority.
The CLI exposes this boundary as `assistant-adapted` with `--adapter-response`.
`steward-dashboard --path HISTORY --output-path REPORT.html --confirm` captures
one report and opens the local HTML dashboard through the fixed platform opener;
`npm run package:workstation` builds its bounded cross-platform runtime bundle,
including fixed dashboard, steward, tray, storage-guard, and network-monitor
launchers.
When supplied a workstation report, it also answers which observed process is
the latest CPU or I/O leader; without sampled report evidence it returns an
observation-required result.
Named power profiles map only to documented platform profiles; unsupported
platforms remain unsupported and firmware or fan-register control is not
attempted.

`power-monitor` adds trigger-based observed, continued, and changed profile
events around battery, thermal, and workload facts. Optional application
requires `--auto-apply --confirm` and remains limited to documented adapter
controls.

`process-overview` combines bounded process and startup evidence with plain
role, usage, runtime, and stop-impact explanations. `process-stop-preview`
selects one observed PID and refuses foreground, protected, system, runtime,
model, credential, and user-protected names. `process-stop-apply` is a separate
explicit operation requiring confirmation and the platform adapter's approval
boundary.

Daily workstation reports reduce consecutive process samples into measured
CPU and read/write I/O rates, latest CPU/I/O leaders, rate-ready sample counts,
and counter-reset events. Missing or changed process identity remains unknown.

`startup-preview` and `startup-apply` select one exact observed startup entry.
Linux and macOS user startup files are renamed to an optimizer-owned
`.rnk-disabled` suffix and return a restore receipt. Windows accepts only the
documented HKCU/HKLM Run registry locations and removes one named value, also
returning a restore receipt. Unknown locations, symlinks, protected names,
occupied restore paths, and unsupported platforms refuse. `startup-restore`
requires the receipt and explicit confirmation.

## PC mesh and empirical proof

`pc/mesh.js` registers 38 engines, 38 engine libraries, 152 turbos, and 152
turbo libraries, or 190 libraries total, behind typed local command/event routes. Nodes are lazy-loaded
and execution requires a declared trigger. The mesh is in-process only: it
does not use HTTP, REST, sockets, public listeners, or network mutation.

The engine and turbo counts are inventory data, not performance proof. The
public benchmark measures host observations including facts latency,
event-loop delay, temporary I/O, power-state visibility, and cache preview /
reclamation behavior. It does not apply system actions or claim an
optimization improvement. A host result must be evaluated as:

```text
engine or domain -> evidence -> decision -> measured host result
```

## Verification

```bash
npm ci
npm run verify
npm run native:facts
```

`npm run verify` is the reproducible public-checkout gate. It runs the strict
100% Jest coverage gate, an independent per-file 100/100/100/100 verifier,
lint, every ESM syntax check, the bounded public identity scan, and the
observational host benchmark. The CI workflow invokes the same command from a
clean checkout.

The Jest configuration is a strict 100% statements, branches, functions, and
lines gate over every collected JavaScript (`.js`) runtime authority file in
`pc/`, `native/`, and the browser media host. The native and
script ESM CLI adapters (`.mjs`) are intentionally kept as thin dispatch
surfaces. `native/cli-utils.mjs`, `native/cli-media.mjs`,
`scripts/verify-public-boundary.mjs`, `scripts/verify-release-provenance.mjs`,
`scripts/pc-host-benchmark.mjs`, `native/cli-maintenance.mjs`, and
`native/cli.mjs` are included in the strict Jest gate. The independent verifier
also checks every collected file's statements, branches, functions, and
executable lines, so a global average cannot mask an under-covered file. All
collected JavaScript and ESM adapter files are covered by the same gate; the
benchmark adapter remains observational tooling, and its coverage verifies
dispatch behavior, not host-performance claims. The CI workflow runs these
checks from a clean checkout; unsupported coverage is not presented as green.

The benchmark is observational evidence only. A passing local suite does not
prove a clean-machine install, Windows execution, a live gateway, or a real
administrative apply. Those require platform-specific verification and
Odinn's sign-off.

## Release provenance

Public release tags must be annotated, signed, and point at the exact tested
commit. Release automation produces a deterministic archive, SHA-256
checksum, provenance metadata, and a GitHub build attestation. The release
workflow runs the same full `npm run verify` gate before producing those
artifacts. Unsigned or floating branch installs are not release evidence.

## License and attribution

Copyright © 2026 Lisa's Dungeon.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, version 3.

See [LICENSE](LICENSE), [NOTICE](NOTICE), and [TRADEMARKS.md](TRADEMARKS.md).
