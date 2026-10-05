# Changelog

## Unreleased

- Added bounded multi-GPU utilization, temperature, and VRAM aggregation.
- Added no-GPU, normal, elevated, high, and unknown states.
- Added conservative headless and interactive GPU protection guidance.
- Added trigger, fact, clock, and refusal-path validation.
- Added a dedicated library for GPU observation aggregation, snapshot
  comparison, immutable envelopes, and local facade construction.
- Added four dedicated turbo families with independent libraries:
  `utilization-burst`, `thermal-margin`, `vram-pressure`, and
  `multi-gpu-skew`.
- Added eight-file family regression: 8 suites and 40 tests at
  100/100/100/100/100/100 coverage; pending Odinn sign-off.
- Pending Odinn sign-off; not release-certified.
