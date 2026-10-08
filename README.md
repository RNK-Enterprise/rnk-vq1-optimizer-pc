# RNK Vortex System Optimizer

This repository is the PC face of the optimizer. The native agent under
`native/` measures the host and applies only bounded, locally validated
actions. The analysis engines and local typed mesh under `pc/` are separate
from the Foundry face, which is released independently.

The installer supports Windows and Linux. iOS is a controller-only surface;
iOS cannot install a service that tunes the whole device.

## Safety model

Installation requires an explicit environment choice:

- `headless` is CLI-first and does not assume a desktop session.
- `interactive` permits desktop-oriented control while retaining the same
  preview-first and approval boundaries.

Installing does not change the operating system. `facts` is read-only.
`optimize` requests a bounded data-only plan and previews it by default.
Applying a plan, administrative actions, cache deletion, and file
organization are separate explicit operations.

The native agent does not sweep arbitrary directories, alter user files,
install undocumented gaming tweaks, manipulate packets, or change network
configuration. File organization is a separate preview/confirm workflow and
never overwrites an existing destination.

## Supported native controls

The current platform adapters provide documented controls for:

- Windows power profile and process priority.
- Linux power profile, process priority, and process I/O priority.
- Optimizer-owned temporary-cache preview and explicit cleanup.
- Read-only CPU, memory, storage, process, network, and optional NVIDIA facts.

GPU policy, CPU affinity, memory policy, network tuning, and frame-rate
control are reported as unsupported until a platform-safe implementation is
added. NVIDIA facts are observational only. The browser host under
`scripts/pc-host.js` does not execute operating-system commands.

## Install from Git

Linux:

```bash
./install/linux/install.sh --mode interactive
```

Windows PowerShell:

```powershell
.\install\windows\install.ps1 -EnvironmentMode interactive
```

Both installers require Git, npm, and Node.js 20 or newer. They clone or
fast-forward the repository, run `npm ci`, save the environment mode outside
the checkout, and collect read-only facts.

To request an optimization preview during installation, provide the VQ
gateway explicitly:

```bash
./install/linux/install.sh --mode headless --run-optimize \
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
node native/cli.mjs organize-preview --root "$HOME/Downloads"
node native/cli.mjs organize-apply --root "$HOME/Downloads" --confirm
```

The optimizer gateway supplies bounded data. The native adapter validates the
protocol, action allow-list, numeric limits, approvals, and admin boundary
before any action can run. No arbitrary command or setting path is accepted.

## PC mesh

`pc/mesh.js` registers 34 engines, 34 engine libraries, 136 turbos, and 136
turbo libraries behind typed local command/event routes. Nodes are lazy-loaded
and execution requires a declared trigger. The mesh is in-process only: it
does not use HTTP, REST, sockets, public listeners, or network mutation.

The mesh produces immutable review envelopes. The native platform adapter is
the only authority allowed to apply operating-system actions.

## Verification

```bash
npm ci
npm test
npm run lint
npm run bench -- --json
npm run native:facts
```

The Jest configuration requires 100% statements, branches, functions, and
lines for its configured coverage set. The PC/native readiness gate also runs
the complete PC tree with the same four coverage dimensions.

The repository is not release-certified until the exact checkout, installer,
platform apply path, and all RNK review requirements have been independently
verified and Odinn has signed off.

## License and attribution

Copyright © 2026 Lisa's Dungeon.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, version 3 of the License.

This program is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

See [LICENSE](LICENSE), [NOTICE](NOTICE), and [TRADEMARKS.md](TRADEMARKS.md).
