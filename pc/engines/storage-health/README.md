# Storage Health Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies bounded storage occupancy, read-only status, and
optional healthy/degraded/failed labels. It distinguishes capacity review
from data-protection review and keeps unknown health evidence visible.

It is analysis-only. It does not repair, remount, delete, organize, modify
files, or open transport.

The dedicated `library.js` classifies occupancy and health evidence, compares
storage snapshots, and emits immutable local review envelopes without storage
mutation.

The four lazy-loaded turbo pairs are:

- `capacity-drift`: bounded occupancy pressure persistence.
- `health-degradation`: failed and degraded health persistence.
- `read-only-drift`: elevated read-only ratio persistence.
- `storage-confidence`: completeness of storage fact evidence.

Each turbo has a dedicated library for validation, safety-precedence merging,
environment-aware observation plans, immutable envelopes, and local factory
construction. No pair opens HTTP, API, REST, socket, or public-listener
transport.
