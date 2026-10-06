# Background Services Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine reports documented service state, critical failures, unknown
states, and user ownership hints. It preserves service ownership and does not
infer permission to disable background work.

It is analysis-only. It does not start, stop, disable, terminate, modify
service files, or open transport.

The dedicated library is `pc/engines/background-services/library.js`. It
classifies normalized service observations for the engine and remains
analysis-only.

The engine now has four lazy, trigger-driven turbo/library pairs:

- `state-drift`: bounded service state comparison and persistence review.
- `criticality-boundary`: failed, unknown, and user-owned critical-service evidence.
- `ownership-review`: explicit service-owner evidence and user-boundary preservation.
- `observation-boundary`: explicit observation capability without changing it.

Each pair is local analysis only. The libraries validate turbo reports, merge
bounded evidence, build environment-aware observation plans, and create
triggered envelopes. No pair starts, stops, disables, terminates, or modifies
services, and no pair opens a network transport.
