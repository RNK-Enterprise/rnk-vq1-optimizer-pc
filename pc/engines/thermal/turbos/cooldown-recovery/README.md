# Thermal Cooldown-Recovery Turbo

Status: implementation complete locally; pending Odinn sign-off.

Tracks bounded temperature recovery and thermal rebound without treating either
as permission to change system controls.

It is analysis-only, lazy, and trigger-driven. It does not change fans,
governors, workloads, power state, files, or transport.
