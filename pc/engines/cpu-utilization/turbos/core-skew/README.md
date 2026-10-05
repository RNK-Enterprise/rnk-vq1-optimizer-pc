# CPU Utilization Core-Skew Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo analyzes per-core utilization vectors, bounded skew, overloaded-core
observations, and dominant-core migration. It is analysis-only and does not
change affinity, scheduling, files, or transport.
