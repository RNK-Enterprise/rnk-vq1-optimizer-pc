# Native whole-PC optimizer

This directory is the operating-system agent. It is separate from the Foundry
module and from the browser host under `pc/`.

The agent measures CPU, memory, and optional NVIDIA GPU facts locally. The VQ
gateway may return a bounded, data-only plan. The local Windows or Linux
adapter owns the executable allow-list and applies only validated actions.

## Safe use

```sh
node native/cli.mjs facts
node native/cli.mjs optimize --gateway http://127.0.0.1:9999/optimizer/v1/plan
node native/cli.mjs optimize --gateway http://127.0.0.1:9999/optimizer/v1/plan --apply --approve=clear-cache
node native/cli.mjs optimize --gateway http://127.0.0.1:9999/optimizer/v1/plan --apply --allow-admin
node native/cli.mjs cache-preview --target user-temp --max-age-hours 24
node native/cli.mjs cache-clean --target user-temp --confirm
node native/cli.mjs organize-preview --root "$HOME/Downloads"
node native/cli.mjs organize-apply --root "$HOME/Downloads" --confirm
```

`optimize` is preview-only unless `--apply` is supplied. Cache cleanup and
process stopping are destructive actions and require explicit approval. File
organization is never part of an optimization plan; it is a separate
preview/confirm workflow and never overwrites an existing destination.

Admin-required actions are reported separately and remain blocked unless
`--allow-admin` is supplied. The report also separates normal-user actions.
This slice contains no network-tuning action, packet manipulation, registry
hack, timer tweak, or undocumented gaming preset. Network behavior is not
changed by the native agent.

Supported real controls in this slice are Windows power profile/process
priority and Linux power profile/process priority/process I/O priority. GPU
policy, CPU affinity, and memory policy remain explicit unsupported results
until a platform-safe implementation is added. NVIDIA facts are observational
only. The default temp target is an optimizer-owned subdirectory; the agent
does not sweep an entire system temp directory or arbitrary user directories.

The iOS path is controller-only. iOS cannot install a service that tunes the
whole device; see `install/ios/README.md` for the remote-control boundary.
