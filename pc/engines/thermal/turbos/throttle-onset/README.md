# Thermal Throttle-Onset Turbo

Status: implementation complete locally; pending Odinn sign-off.

Tracks normalized temperature-ratio bands, risk persistence, and threshold
crossings over bounded samples.

It is analysis-only, lazy, and trigger-driven. It does not change governors,
fans, workloads, power state, files, or transport.
