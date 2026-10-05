# CPU Affinity Mask-Skew Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo compares normalized affinity coverage, isolation coverage, and
affinity/isolation overlap across a bounded topology sample window. It
classifies stable layouts, overlap risk, over-isolation, under-coverage,
insufficient evidence, and missing observations.

It is analysis-only. It never applies masks, pins processes, changes files or
settings, or opens transport. It is lazy and trigger-driven.

Its dedicated `library.js` validates topology reports, merges coverage and
overlap evidence, builds environment-aware review plans, and creates
immutable local envelopes without importing the turbo implementation.
