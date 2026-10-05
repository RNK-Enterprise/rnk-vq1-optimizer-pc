# Network Observation Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine reports bounded link, mesh, state, and default-route evidence. It
keeps ambiguous routes and missing observations explicit for review.

It is observation-only. It does not change routes, DNS, MTU, interfaces,
firewalls, files, or transport.

The dedicated library is `pc/engines/network-observation/library.js`. It
classifies normalized network observations for the engine and remains
observation-only.
