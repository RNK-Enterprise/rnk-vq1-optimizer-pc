# CPU Affinity Topology-Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo observes physical CPU, logical CPU, and socket topology across a
bounded sample window. It classifies stable topology, topology watch,
frequent drift, inconsistent topology, insufficient evidence, and missing
observations.

It is analysis-only. It never pins processes, applies masks, changes files or
settings, or opens transport. It is lazy and trigger-driven.

Its dedicated `library.js` validates topology reports, merges weighted change
evidence, builds environment-aware review plans, and creates immutable local
envelopes without importing the turbo implementation.
