# Swap Accounting-Consistency Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo compares total/free swap accounting with reported utilization. It
identifies consistent accounting, sensor disagreement, no-swap ownership,
missing observations, and invalid capacity evidence within a bounded sample
window.

It is analysis-only. It does not create swap, change swappiness, reclaim
memory, clear caches, touch user files, alter settings, open sockets, or use
HTTP, REST, or API transport. It is trigger-gated and keeps its sample window
bounded.

Its future mesh endpoint is a separate integration step.
