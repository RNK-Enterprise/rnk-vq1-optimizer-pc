# Changelog

## Unreleased

- Added CPU workload-profile classification for interactive and headless hosts.
- Added governor normalization and alignment reporting.
- Added conservative review guidance for powersave or unknown governors.
- Added dedicated scheduler-pressure classification, deltas, sampling, and envelope library.
- Added trigger, fact, clock, and refusal-path validation.
- Added the `run-queue-burst`, `context-churn`, `queue-utilization-mismatch`,
  and `governor-transitions` turbo analyses with four dedicated libraries.
- Gated all eight CPU-scheduler turbo/library files at 100/100/100/100/100/100;
  family regression passed with 8 suites and 32 tests.
- Pending Odinn sign-off; not release-certified.
