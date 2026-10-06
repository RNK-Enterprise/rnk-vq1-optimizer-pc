# Shader-Cache Validity-Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo compares explicit valid, stale, and unknown shader-cache evidence
over a bounded sample window.

It is analysis-only. It does not delete caches, rebuild files, change drivers,
or open transport. It fires only for an explicit supported trigger and loads
its analysis when invoked.

Its dedicated `library.js` validates validity reports, merges evidence, builds
review plans, and creates trigger envelopes without cache mutation.
