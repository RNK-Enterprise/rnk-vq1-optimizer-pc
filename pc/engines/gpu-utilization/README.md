# GPU Utilization Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine aggregates bounded GPU utilization, temperature, VRAM, and model
observations. It distinguishes no-GPU hosts from unknown measurements and
reports separate headless-service and interactive-foreground protection
states.

It is analysis-only. It does not change GPU policy or drivers, access files,
or open transport.
