# Thermal Sensor-Stability Turbo

Status: implementation complete locally; pending Odinn sign-off.

Tracks thermal sensor completeness and bounded temperature or fan jitter while
preserving missing evidence as a review state.

It is analysis-only, lazy, and trigger-driven. It does not change sensors,
fans, governors, power state, files, or transport.
