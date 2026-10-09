# PC optimizer architecture

## Scope

This checkout is the public PC optimizer release. It contains the native
Windows/Linux/macOS authority, the browser-owned local media surface, the PC
analysis engines, and the local typed mesh.

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
      Windows/Linux/macOS adapter
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

`pc/mesh.js` exposes typed command and event routes for 38 engines, 38
dedicated engine libraries, 152 turbos, and 152 dedicated turbo libraries.
Every node is lazy-loaded. Engine execution requires one of the declared
trigger paths. Dispatch creates an immutable review envelope and rejects
unknown nodes, routes, triggers, clocks, and payload shapes.

The PC mesh is an in-process boundary. It does not open a listener or use
HTTP, REST, sockets, public ports, or network mutation. The mesh performs
analysis and review; it does not bypass the native adapter.

## Native authority

The native agent collects bounded local facts and can request a bounded plan
from the configured gateway. The platform adapters own all executable actions.
Supported documented controls include Windows ROG/admin-boundary facts, power
profiles, process priority, per-process NetQos shaping, bounded NVIDIA power
caps, observed-controller FPS caps, Linux resource controls, macOS launchd
hard limits, optimizer-owned temporary-cache cleanup, and read-only host facts.

Universal FPS enforcement remains a capability result: the local authority
refuses to claim a hard cap unless the host reports a named controller backend.
Existing macOS PIDs are refused for hard CPU/RAM attachment; only future
launchd jobs receive those limits.

## Cache ownership

The `user-temp` target is an optimizer-owned directory under the platform
temporary directory. D3D, NVIDIA, and Mesa shader-cache paths are generated
by the platform or driver, not owned by this optimizer. They are exposed only
as fixed, explicit preview targets and require the same explicit approval for
reclamation; the optimizer does not claim ownership of their contents.

## Verification boundary

The repository gates validate the PC inventory, native protocol, local mesh,
install scripts, strict coverage, host benchmark, and release provenance
policy. A passing local suite does not prove a clean-machine install, Windows
ROG execution, a live gateway, or a real administrative apply. Those require
the target environment and Odinn's sign-off. Release attestation binds
artifact SHA-256 values to a verified signed tag but does not manufacture a
signing key or deployment proof.
