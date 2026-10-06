# Shader-Cache Size-Trend Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo compares explicit shader-cache sizes over a bounded sample window
and distinguishes growth, shrinkage, stable size, and incomplete evidence.

It is analysis-only. It does not read beyond supplied facts, delete caches,
rebuild files, change drivers, or open transport. It fires only for an explicit
supported trigger and loads its analysis when invoked.

Its dedicated `library.js` validates size reports, merges evidence, builds
review plans, and creates trigger envelopes without file mutation.
