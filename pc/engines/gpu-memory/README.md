# GPU Memory Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine measures bounded GPU memory capacity and usage evidence from the
trusted system-facts snapshot. It identifies observed, capacity-only,
unknown, elevated, and high-memory states for headless and interactive hosts.

It is analysis-only. It does not change GPU policy, drivers, files, or
transport state. Out-of-range usage is bounded for classification and the raw
observed value remains visible in the report.

The dedicated `library.js` classifies VRAM occupancy, compares snapshots, and
emits immutable local review envelopes without changing allocation policy.
