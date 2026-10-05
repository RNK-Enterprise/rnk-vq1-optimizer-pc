# Memory Pressure OOM Margin Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo computes a conservative composite memory margin from RAM headroom
and available-memory ratio. It classifies safe, narrow, critical, converging,
invalid, unknown, and insufficient margin evidence.

The turbo is analysis-only. It does not reclaim memory, clear caches, touch
user files, alter settings, open sockets, or use HTTP, REST, or API transport.
It fires only on system-facts, workload, and health triggers and keeps all
windows and thresholds bounded.

Its future mesh endpoint is a separate integration step.

The dedicated library validates and aggregates only OOM-margin reports, builds
environment-specific observation plans, and emits immutable local envelopes.
It does not import the turbo or the engine library.
