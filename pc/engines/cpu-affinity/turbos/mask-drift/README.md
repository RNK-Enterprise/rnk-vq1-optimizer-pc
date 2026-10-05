# CPU Affinity Mask-Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo measures bounded changes in normalized affinity and isolation lists
using Jaccard-style list distance. It classifies stable layout, drift watch,
high drift, frequent drift, insufficient evidence, and missing observations.

It is analysis-only. It never applies masks, pins processes, changes files or
settings, or opens transport. It is lazy and trigger-driven.

Its dedicated `library.js` validates drift reports, merges weighted list-change
evidence, builds environment-aware observation plans, and creates immutable
local envelopes without importing the turbo implementation.
