# CPU Scheduler Run-Queue Burst Turbo

Status: implementation complete locally; pending Odinn sign-off.

This turbo measures bounded run-queue and context-switch pressure from
normalized system-facts snapshots. It classifies insufficient evidence,
missing observations, sustained pressure, burst pressure, rising pressure,
and stable windows.

It is analysis-only. It never changes scheduler policy, process priority,
affinity, files, settings, or transport state. The implementation is lazy
and trigger-driven through its exported function.
