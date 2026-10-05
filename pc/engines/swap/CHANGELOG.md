# Changelog

## Unreleased

- Added no-swap, normal, elevated, high, and unknown state classification.
- Added swap headroom evidence and conservative pressure recommendations.
- Added explicit user-owned no-swap handling.
- Added trigger, fact, clock, and refusal-path validation.
- Added a dedicated library for swap classification, snapshot comparison,
  immutable envelopes, and local facade construction.
- Added four dedicated turbo families with independent libraries:
  `pressure-dwell`, `headroom-collapse`, `availability-drift`, and
  `accounting-consistency`.
- Added eight-file family regression: 8 suites and 40 tests at
  100/100/100/100/100/100 coverage; pending Odinn sign-off.
- Pending Odinn sign-off; not release-certified.
