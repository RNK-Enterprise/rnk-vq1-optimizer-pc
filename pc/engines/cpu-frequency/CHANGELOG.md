# Changelog

## Unreleased

- Added CPU governor and driver classification.
- Added adaptive, fixed, vendor-specific, and unknown evidence states.
- Added conservative headless throughput-policy review guidance.
- Added trigger, fact, clock, and refusal-path validation.
- Added the dedicated CPU-frequency library with comparison and envelope APIs.
- Added the `policy-shift` and `load-governor-mismatch` turbo analyses with
  dedicated libraries.
- Added the `frequency-residency` and `boost-headroom` turbo analyses with
  dedicated libraries.
- Gated all eight CPU-frequency turbo/library files at
  100/100/100/100/100/100; family regression passed with 8 suites and 36 tests.
- Pending Odinn sign-off; not release-certified.
