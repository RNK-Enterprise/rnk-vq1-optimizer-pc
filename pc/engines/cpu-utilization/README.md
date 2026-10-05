# CPU Utilization Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies normalized CPU utilization as idle, balanced, busy,
saturated, or unknown. It reports headroom, logical CPU count, confidence,
and environment-aware guidance for interactive foreground work or headless
services.

It is analysis-only. It does not change scheduling, frequency, affinity,
files, settings, or transport state.
