# FPS Target: Observation Confidence Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo scores refresh, FPS, and user-target evidence as
complete, partial, or low-confidence observations. It keeps incomplete,
headless, and disabled telemetry from becoming an automatic control decision.

It is lazy-loaded by the FPS-target engine and fires only on the four declared
triggers. It never applies a cap, changes display policy, modifies files, or
opens transport.
