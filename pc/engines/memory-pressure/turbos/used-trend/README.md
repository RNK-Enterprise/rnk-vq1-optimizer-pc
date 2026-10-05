# Memory Pressure Used Trend Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo classifies bounded RAM-utilization movement as stable, rising,
falling, volatile, or high pressure. It also rejects out-of-range sensor
evidence and preserves unknown samples instead of treating them as clean.

The turbo is analysis-only. It does not reclaim memory, clear caches, touch
user files, alter settings, open sockets, or use HTTP, REST, or API transport.
It fires only on system-facts, workload, and health triggers and keeps its
sample window and thresholds bounded.

Its future mesh endpoint is a separate integration step.
