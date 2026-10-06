# Battery Power-Source-Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo compares explicit battery presence and charging-state evidence over
a bounded sample window. It preserves source drift and incomplete evidence.

It is analysis-only. It does not change charging, power policy, files, or
transport. It fires only for an explicit supported trigger and loads its
analysis when invoked.

Its dedicated `library.js` validates source reports, merges evidence, builds
review plans, and creates trigger envelopes without toggling controls.
