# Network Observation Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine reports bounded link, mesh, state, and default-route evidence. It
keeps ambiguous routes and missing observations explicit for review.

It is observation-only. It does not change routes, DNS, MTU, interfaces,
firewalls, files, or transport.

The dedicated library is `pc/engines/network-observation/library.js`. It
classifies normalized network observations for the engine and remains
observation-only.

Dedicated turbo/library pairs:

- `route-stability`: bounded default-route identity and count changes.
- `link-health`: documented interface-state changes with unknown-state refusal.
- `mesh-evidence`: explicit mesh membership changes with absent-flag refusal.
- `interface-inventory`: explicit interface name/kind additions and removals.

Each pair lazy-loads through its explicit local import boundary and fires only
on declared triggers. The family uses no HTTP, API, REST, socket, or
public-listener transport and never mutates routes, DNS, MTU, interfaces,
firewalls, files, or network settings.
