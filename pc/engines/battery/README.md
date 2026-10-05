# Battery Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies battery presence, charge, charging state, health, and
observation capability. Headless hosts with no battery remain explicit no-
battery environments rather than receiving laptop-specific recommendations.

It is analysis-only. It does not change charging, power policy, files, or
transport.

The dedicated library is `pc/engines/battery/library.js`. It classifies
normalized battery observations for the engine and remains analysis-only.
