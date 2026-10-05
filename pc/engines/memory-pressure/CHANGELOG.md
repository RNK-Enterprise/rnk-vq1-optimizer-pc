# Changelog

## Unreleased

- Added bounded RAM pressure and headroom classification.
- Added swap observation and confidence reporting.
- Added conservative headless and interactive protection states.
- Added trigger, fact, clock, and refusal-path validation.
- Added a dedicated library for pressure classification, snapshot comparison,
  immutable envelopes, and local facade construction.
- Added the `used-trend`, `swap-thrash`, `headroom-volatility`, and `oom-margin`
  turbo analyses with dedicated libraries.
- Gated all eight memory-pressure turbo/library files at
  100/100/100/100/100/100; family regression passed with 8 suites and 40 tests.
- Pending Odinn sign-off; not release-certified.
