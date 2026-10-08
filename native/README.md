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
