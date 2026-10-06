# Changelog

## Unreleased

- Added bounded GPU VRAM capacity and usage aggregation.
- Added no-GPU, capacity-only, observation-disabled, elevated, and high states.
- Added conservative headless and interactive memory-pressure guidance.
- Added trigger, fact, clock, and refusal-path validation.
- Added a dedicated library for VRAM occupancy classification, snapshot
  comparison, immutable envelopes, and local facade construction.
- Added four strict-gated turbos: occupancy drift, allocation headroom,
  capacity skew, and counter integrity.
- Added four dedicated turbo libraries with report validation, merge, plan,
  envelope, and factory boundaries.
- Verified the complete GPU-memory turbo/library family with 8 suites, 40
  tests, and 100% statements, branches, functions, and lines.
- Pending Odinn sign-off; not release-certified.
