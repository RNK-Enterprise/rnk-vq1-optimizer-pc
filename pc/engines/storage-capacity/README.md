# Storage Capacity Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine aggregates bounded total and free storage capacity and classifies
minimum free-space headroom. It keeps missing capacity evidence explicit and
protects user ownership of files and storage layout.

It is analysis-only. It does not delete, move, organize, repair, remount,
modify files, or open transport.

The dedicated `library.js` aggregates bounded capacity, compares headroom
snapshots, and emits immutable local review envelopes without storage changes.

The four lazy-loaded turbo pairs are:

- `free-space-drift`: bounded minimum free-space pressure persistence.
- `volume-skew`: per-volume free-space imbalance persistence.
- `capacity-evidence`: mount, total-byte, and free-byte fact completeness.
- `headroom-trend`: adjacent-sample free-space decline detection.

Each turbo has a dedicated library for validation, safety-precedence merging,
environment-aware observation plans, immutable envelopes, and local factory
construction. No pair opens HTTP, API, REST, socket, or public-listener
transport.
