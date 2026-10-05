# Changelog

## Unreleased

- Added bounded GPU vendor, model, driver, and observation classification.
- Added explicit no-GPU, observation-disabled, incomplete, vendor-review, and
  profile-required states.
- Added documented-driver evidence checks without applying GPU changes.
- Added trigger, fact, clock, and refusal-path validation.
- Added a dedicated library for vendor and driver evidence classification,
  snapshot comparison, immutable envelopes, and local facade construction.
- Added four strict-gated turbos: driver drift, vendor mix, observation
  boundary, and evidence completeness.
- Verified the GPU-policy turbo family with 4 suites, 20 tests, and 100%
  statements, branches, functions, and lines.
- Pending Odinn sign-off; not release-certified.
