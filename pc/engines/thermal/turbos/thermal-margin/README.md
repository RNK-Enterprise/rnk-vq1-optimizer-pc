# Thermal Margin Turbo

Status: implementation complete locally; pending Odinn sign-off.

Tracks critical-temperature headroom over bounded samples and distinguishes
stable, recovering, low, collapsing, critical, and incomplete evidence.

It is analysis-only, lazy, and trigger-driven. It does not change fans,
governors, workloads, power state, files, or transport.
