# Background-Services Criticality-Boundary Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo reports explicit critical-service failures, unknown states, and
user-owned critical-service hints. Unknown critical evidence is not treated as
safe.

It is analysis-only. It does not start, stop, disable, terminate, modify
service files, or open transport. It fires only for an explicit supported
trigger and loads its analysis when invoked.

Its dedicated `library.js` validates criticality reports, merges protection
evidence, builds observation plans, and creates trigger envelopes without
controlling services.
