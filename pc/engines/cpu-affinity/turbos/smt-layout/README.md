# CPU Affinity SMT-Layout Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo measures logical-to-physical CPU ratios across a bounded sample
window. It classifies stable SMT, heavy SMT, ratio shift, inconsistent layout,
insufficient evidence, and missing observations.

It is analysis-only. It never changes affinity, applies masks, modifies files
or settings, or opens transport. It is lazy and trigger-driven.

Its dedicated `library.js` validates SMT reports, merges weighted ratio
evidence, builds environment-aware review plans, and creates immutable local
envelopes without importing the turbo implementation.
