# Changelog

## Unreleased

- Added bounded per-process read, write, and I/O-wait aggregation.
- Added normal, elevated, high, unknown, empty, and disabled states.
- Added conservative storage-contention review guidance.
- Added trigger, fact, clock, process-list, and refusal-path validation.
- Added a dedicated library for I/O aggregation, snapshot comparison,
  immutable envelopes, and local facade construction.
- Added four RNK Enterprise turbo/library pairs: contention burst, read-write
  skew, service contention, and observation confidence.
- Added strict per-file tests for every turbo and library with bounded inputs,
  disabled-observation and headless handling, trigger validation, immutable
  outputs, and 100% coverage across statements, branches, functions, and
  lines.
- Pending Odinn sign-off; not release-certified.
