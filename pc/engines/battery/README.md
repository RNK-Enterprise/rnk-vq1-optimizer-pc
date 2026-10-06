# Battery Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies battery presence, charge, charging state, health, and
observation capability. Headless hosts with no battery remain explicit no-
battery environments rather than receiving laptop-specific recommendations.

It is analysis-only. It does not change charging, power policy, files, or
transport.

The dedicated library is `pc/engines/battery/library.js`. It classifies
normalized battery observations for the engine and remains analysis-only.

The engine now has four lazy, trigger-driven turbo/library pairs:

- `charge-trend`: bounded charge movement and recovery or loss review.
- `health-boundary`: explicit health degradation and failed-health protection evidence.
- `power-source-drift`: battery presence and charging-state transition review.
- `charge-ceiling`: high-charge ceiling persistence and movement review.

Each pair is analysis-only. Its library validates turbo reports, merges
bounded evidence, builds environment-aware review plans, and creates triggered
envelopes. No pair changes charging, imposes a charge limit, changes power
policy, modifies files, or opens transport.
