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
