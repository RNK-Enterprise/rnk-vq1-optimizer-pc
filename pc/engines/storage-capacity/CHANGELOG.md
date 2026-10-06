# Changelog

## Unreleased

- Added bounded total, free, and minimum-headroom aggregation.
- Added normal, elevated, high, unknown, and empty capacity states.
- Added free-space review guidance without storage mutation.
- Added trigger, fact, clock, storage-list, and refusal-path validation.
- Added a dedicated library for capacity aggregation, snapshot comparison,
  immutable envelopes, and local facade construction.
- Added four lazy-loaded turbo/library pairs for free-space drift, volume skew,
  capacity evidence, and headroom trend.
- Added per-file strict Jest gates at 100% statements, branches, functions,
  and lines for the new pair implementations.
- Pending Odinn sign-off; not release-certified.
