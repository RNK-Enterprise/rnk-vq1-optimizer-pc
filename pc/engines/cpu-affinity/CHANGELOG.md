# Changelog

## Unreleased

- Added physical/logical CPU and socket topology classification.
- Added SMT-layout, multi-socket, inconsistent-topology, and unknown states.
- Added conservative affinity recommendations and confidence reporting.
- Added trigger, fact, clock, and refusal-path validation.
- Added a dedicated library for affinity-list normalization, snapshot comparison,
  immutable envelopes, and local facade construction.
- Added the `mask-skew`, `mask-drift`, `topology-drift`, and `smt-layout` turbo
  analyses with four dedicated libraries.
- Gated all eight CPU-affinity turbo/library files at 100/100/100/100/100/100;
  family regression passed with 8 suites and 32 tests.
- Pending Odinn sign-off; not release-certified.
