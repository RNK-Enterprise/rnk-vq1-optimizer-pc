# PC optimizer architecture

## Scope

This checkout is the PC face of the optimizer. It contains the native
Windows/Linux authority, the host-neutral browser surface, the PC analysis
engines, and the local typed mesh. The Foundry face is released separately
and is not required by the PC installers.

## Control flow

```text
host facts
    |
    v
bounded gateway plan (data only)
    |
    v
native protocol validation
    |
    +--> preview report
    |
    +--> explicit approvals
             |
             v
      Windows/Linux adapter
```

The native agent is the only component that can request an operating-system
action. It validates the protocol version, action allow-list, numeric bounds,
plan lifetime, action count, and approval state before dispatch. It does not
accept executable code, arbitrary setting paths, or unbounded file targets.

The gateway URL and optional credential are supplied by the operator through
the CLI or environment. The installer never invents a gateway and refuses an
installer-time optimization request when one is not configured.

## Environment posture

The installer requires an explicit `headless` or `interactive` mode before
cloning, updating, installing dependencies, or collecting facts. The mode
controls the front-end posture only; it is not permission to apply actions.

Normal-user actions and administrator-required actions are reported separately.
Administrative work remains blocked unless the operator supplies the explicit
admin flag, and destructive actions require a matching approval.

## Local PC mesh

`pc/mesh.js` exposes typed command and event routes for:

- 34 engines.
- 34 dedicated engine libraries.
- 136 turbos.
- 136 dedicated turbo libraries.

Every node is lazy-loaded. Engine execution requires one of the declared
trigger paths. Dispatch creates an immutable review envelope and rejects
unknown nodes, routes, triggers, clocks, and payload shapes.

The PC mesh is an in-process boundary. It does not open a listener or use
HTTP, REST, sockets, public ports, or network mutation. The mesh performs
analysis and review; it does not bypass the native adapter.

## Native authority

The native agent collects bounded local facts and can request a bounded plan
from the configured gateway. The platform adapters own all executable actions.
Supported documented controls are:

- Windows power profile and process priority.
- Linux power profile, process priority, and process I/O priority.
- Optimizer-owned temporary-cache preview and explicit cleanup.
- Read-only CPU, memory, storage, process, network, and optional NVIDIA facts.

GPU policy, CPU affinity, memory policy, network tuning, and frame-rate
control remain explicit unsupported results until a safe platform-specific
implementation is added and proven.

## File safety

Cache cleanup targets an optimizer-owned temporary directory by default. It
requires a preview and confirmation. Organization is separate from
optimization, requires a preview and confirmation, never overwrites an
existing destination, and rejects path escapes and unsafe targets.

No operation claims ownership of user files. No operation silently stops a
user process or changes an administrator-owned setting.

## Verification boundary

The repository gates validate the PC inventory, native protocol, local mesh,
install scripts, and configured coverage set. A passing local suite does not
prove a clean-machine install, Windows execution, a live gateway, or a real
administrative apply. Those require platform-specific verification and Odinn
sign-off.
