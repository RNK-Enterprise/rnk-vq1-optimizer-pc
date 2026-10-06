# Battery Charge-Trend Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo measures bounded charge movement and preserves rising, falling,
low-charge, stable, and incomplete-observation states.

It is analysis-only. It does not change charging, power policy, files, or
transport. It fires only for an explicit supported trigger and loads its
analysis when invoked.

Its dedicated `library.js` validates charge reports, merges evidence, builds
review plans, and creates trigger envelopes without controlling charging.
