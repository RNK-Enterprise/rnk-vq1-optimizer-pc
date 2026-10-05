# CPU Frequency Load-Governor-Mismatch Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo compares normalized load with governor evidence across a bounded
sample window. It classifies aligned windows, powersave under load,
performance under idle, mismatch bursts, insufficient evidence, and missing
observations.

It is analysis-only. It never changes frequency policy, writes system files,
or opens transport. It is lazy and trigger-driven.

Its dedicated `library.js` validates load-policy reports, merges weighted
governor alignment evidence, builds environment-aware review plans, and
creates immutable local envelopes without importing the turbo implementation.
