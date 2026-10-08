# RNK Vortex System Optimizer

This repository is the public PC optimizer release. It contains a native
Windows/Linux authority, a PC browser host, and the PC analysis engine tree.
The native agent measures the host and applies only bounded, locally validated
actions.

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

## Supported native controls

The current platform adapters provide documented controls for:

- Windows power profile and process priority.
- Linux power profile, process priority, and process I/O priority.
- Optimizer-owned temporary-cache preview and explicit cleanup.
- Storage Pressure Guard for bounded system-drive monitoring, preview, and
  explicitly approved cleanup of regenerable categories.
- Read-only CPU, memory, storage, process, network, and optional NVIDIA facts.

GPU policy, CPU affinity, memory policy, network tuning, and frame-rate
control remain explicit unsupported results until a platform-safe
implementation is added and proven. NVIDIA facts are observational only. The
browser host under `scripts/pc-host.js` does not execute operating-system
commands.

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
node native/cli.mjs cache-preview --target user-temp --max-age-hours 24
node native/cli.mjs cache-clean --target user-temp --confirm
node native/cli.mjs storage-preview --target-free-gb 5 \
  --enable=temporary-files,package-cache,browser-automation-cache,gpu-shader-cache
node native/cli.mjs storage-cleanup --target-free-gb 5 \
  --enable=temporary-files,package-cache --confirm
node native/cli.mjs storage-monitor --target-free-gb 5 \
  --enable=temporary-files,package-cache --interval-seconds 60
node native/cli.mjs steward-history --path "$HOME/.rnk-optimizer/history.jsonl"
node native/cli.mjs steward-history --path "$HOME/.rnk-optimizer/history.jsonl" \
  --append '{"id":"preview-1","event":"preview","timestamp":0}'
node native/cli.mjs steward-monitor --path "$HOME/.rnk-optimizer/history.jsonl" \
  --interval-seconds 900
node native/cli.mjs organize-preview --root "$HOME/Downloads"
node native/cli.mjs organize-apply --root "$HOME/Downloads" --confirm
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

## PC mesh and empirical proof

`pc/mesh.js` registers 37 engines, 37 engine libraries, 148 turbos, and 148
turbo libraries behind typed local command/event routes. Nodes are lazy-loaded
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
npm test
npm run lint
npm run bench -- --json
npm run native:facts
npm run pc:vq1:check
```

The Jest configuration is a strict 100% statements, branches, functions, and
lines gate over every tracked JavaScript runtime file in `pc/`, `native/`,
and the retained PC host/client modules. No runtime path is excluded from
coverage. The CI workflow runs the same commands from a clean checkout.

The benchmark is observational evidence only. A passing local suite does not
prove a clean-machine install, Windows execution, a live gateway, or a real
administrative apply. Those require platform-specific verification and
Odinn's sign-off.

## Release provenance

Public release tags must be annotated, signed, and point at the exact tested
commit. Release automation produces a deterministic archive, SHA-256
checksum, provenance metadata, and a GitHub build attestation. Unsigned or
floating branch installs are not release evidence.

## License and attribution

Copyright © 2026 Lisa's Dungeon.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, version 3.

See [LICENSE](LICENSE), [NOTICE](NOTICE), and [TRADEMARKS.md](TRADEMARKS.md).
