# Disk I/O Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine aggregates bounded device read/write rates and maximum I/O wait.
It distinguishes normal, elevated, high, unknown, empty, and headless-safe
states for storage contention review.

It is analysis-only. It does not change mounts, queues, files, storage policy,
or transport.

The dedicated `library.js` aggregates device I/O observations, compares
snapshots, and emits immutable local review envelopes without disk mutation.

The four lazy-loaded turbo pairs are:

- `wait-burst`: bounded I/O wait pressure persistence.
- `throughput-skew`: per-disk read/write imbalance persistence.
- `io-evidence`: read, write, and wait fact completeness.
- `wait-trend`: adjacent-sample I/O-wait increase detection.

Each turbo has a dedicated library for validation, safety-precedence merging,
environment-aware observation plans, immutable envelopes, and local factory
construction. No pair opens HTTP, API, REST, socket, or public-listener
transport.
