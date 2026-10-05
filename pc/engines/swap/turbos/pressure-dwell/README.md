# Swap Pressure-Dwell Turbo and Library

Status: implementation complete locally; pending Odinn sign-off.

This turbo measures bounded persistence in elevated and high swap pressure. It
distinguishes sustained pressure from transient or normal observations and
keeps missing or invalid sensor evidence explicit.

It is analysis-only. It does not create swap, change swappiness, reclaim
memory, clear caches, touch user files, alter settings, open sockets, or use
HTTP, REST, or API transport. It is trigger-gated and keeps its sample window
bounded.

Its future mesh endpoint is a separate integration step.

The dedicated library validates pressure-dwell reports, merges bounded counts,
and builds environment-aware observation plans and immutable local envelopes.
It does not import the turbo or change swap policy.
