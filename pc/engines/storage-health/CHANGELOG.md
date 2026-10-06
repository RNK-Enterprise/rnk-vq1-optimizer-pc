# Changelog

## Unreleased

- Added bounded storage occupancy and optional health-label aggregation.
- Added normal, elevated, high, unknown, empty, and data-protection states.
- Added read-only reporting without inferring permission to write.
- Added trigger, fact, clock, storage-list, and refusal-path validation.
- Added a dedicated library for storage-health classification, snapshot
  comparison, immutable envelopes, and local facade construction.
- Added four lazy-loaded turbo/library pairs for capacity drift, health
  degradation, read-only drift, and storage-fact confidence.
- Added per-file strict Jest gates at 100% statements, branches, functions,
  and lines for the new pair implementations.
- Pending Odinn sign-off; not release-certified.
