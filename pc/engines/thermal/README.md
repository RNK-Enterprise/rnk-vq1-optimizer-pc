# Thermal Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies bounded temperature, critical threshold, fan, and
thermal-headroom evidence. It distinguishes interactive foreground protection
from headless service protection without assuming permission to intervene.

It is analysis-only. It does not change fans, governors, workloads, shutdown
policy, files, or transport.

The dedicated library is `pc/engines/thermal/library.js`. It classifies
normalized thermal observations for the engine and remains analysis-only.

The four independent turbo/library pairs are:

- `thermal-margin`: critical-temperature headroom movement.
- `throttle-onset`: normalized temperature-ratio bands and crossings.
- `sensor-stability`: sensor completeness and jitter.
- `cooldown-recovery`: cooling recovery and thermal rebound.

Each pair is lazy and trigger-driven. It returns bounded evidence and review
plans only; it does not change fans, governors, workloads, or power state.
