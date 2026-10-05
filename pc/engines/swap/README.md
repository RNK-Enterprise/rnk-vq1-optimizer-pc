# Swap Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine distinguishes no-swap, normal, elevated, high, and unknown swap
evidence. No-swap hosts remain an explicit user-owned state; high pressure
holds destructive actions and requests review of memory pressure.

It is analysis-only. It does not create swap, change swappiness, access files,
or open transport.
