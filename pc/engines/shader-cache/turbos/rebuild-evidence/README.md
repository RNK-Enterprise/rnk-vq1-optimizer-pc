# Shader-Cache Rebuild-Evidence Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo reviews explicit stale-cache rebuild evidence and distinguishes
documented paths from missing or changing evidence. It never executes a
rebuild.

It is analysis-only. It does not delete caches, rebuild files, change drivers,
or open transport. It fires only for an explicit supported trigger and loads
its analysis when invoked.

Its dedicated `library.js` validates rebuild-evidence reports, merges evidence,
builds review plans, and creates trigger envelopes without execution.
