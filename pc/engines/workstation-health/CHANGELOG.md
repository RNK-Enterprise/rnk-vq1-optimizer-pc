# Changelog

## Unreleased

- Added the daily workstation-health report engine and library.
- Added bounded storage/free-space, drive-health, memory, CPU/GPU, thermal,
  battery, process, workload, and cleanup evidence fields.
- Normalized native plural thermal zones, nested battery telemetry, drive health,
  GPU temperature, and pagefile pressure before daily classification.
- Added explicit warning, critical, healthy, and observation-required states.
- Added storage-trend, resource-pressure, workload-conflict, and cleanup-audit
  turbo/library pairs.
- Kept every output analysis-only with empty action lists and trigger checks.
- Pending Odinn sign-off; not release-certified.
