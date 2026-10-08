# PC optimizer architecture

## Scope

This checkout is the public PC optimizer release. It contains the native
Windows/Linux authority, the PC browser surface, the PC analysis engines, and
the local typed mesh.

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
strict plan lifetime, action count, and approval state before dispatch. It
does not accept executable code, arbitrary setting paths, or unbounded file
targets.

Remote gateway URLs must use HTTPS. Plain HTTP is permitted only for exact
loopback hosts (`localhost`, `127.0.0.1`, and `::1`) during local development.
Credentials are never placed in child-process environments.

## Environment posture

The installer requires an explicit `headless` or `interactive` mode before
cloning, updating, installing dependencies, or collecting facts. The mode
controls the front-end posture only; it is not permission to apply actions.

Normal-user actions and administrator-required actions are reported
separately. Administrative work remains blocked unless the operator supplies
the explicit admin flag, and destructive actions require a matching approval.

## Local PC mesh

`pc/mesh.js` exposes typed command and event routes for 34 engines, 34
dedicated engine libraries, 136 turbos, and 136 dedicated turbo libraries.
Every node is lazy-loaded. Engine execution requires one of the declared
trigger paths. Dispatch creates an immutable review envelope and rejects
unknown nodes, routes, triggers, clocks, and payload shapes.

The PC mesh is an in-process boundary. It does not open a listener or use
HTTP, REST, sockets, public ports, or network mutation. The mesh performs
analysis and review; it does not bypass the native adapter.

## Native authority

The native agent collects bounded local facts and can request a bounded plan
from the configured gateway. The platform adapters own all executable actions.
Supported documented controls are Windows power profile and process priority,
Linux power profile/process priority/process I/O priority, optimizer-owned
temporary-cache cleanup, and read-only host facts.

GPU policy, CPU affinity, memory policy, network tuning, and frame-rate
control remain explicit unsupported results until a safe platform-specific
implementation is added and proven.

## Cache ownership

The `user-temp` target is an optimizer-owned directory under the platform
temporary directory. D3D, NVIDIA, and Mesa shader-cache paths are generated
by the platform or driver, not owned by this optimizer. They are exposed only
as fixed, explicit preview targets and require the same explicit approval for
reclamation; the optimizer does not claim ownership of their contents.

## Verification boundary

The repository gates validate the PC inventory, native protocol, local mesh,
install scripts, strict coverage, host benchmark, and release provenance
policy. A passing local suite does not prove a clean-machine install,
Windows execution, a live gateway, or a real administrative apply. Those
require platform-specific verification and Odinn's sign-off.
