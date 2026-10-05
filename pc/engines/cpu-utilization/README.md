# CPU Utilization Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies normalized CPU utilization as idle, balanced, busy,
saturated, or unknown. It reports headroom, logical CPU count, confidence,
and environment-aware guidance for interactive foreground work or headless
services.

It is analysis-only. It does not change scheduling, frequency, affinity,
files, settings, or transport state.

The dedicated library at `library.js` provides bounded classification, deltas,
sampling guidance, and immutable local envelopes for this engine.

The four implemented turbo analyses are `burst-window`, `saturation-guard`,
`core-skew`, and `trend-slope`. Each turbo has its own implementation,
dedicated library, tests, README, and changelog. The turbo family is locally
gated at 100/100/100/100/100/100 across its eight source files. Mesh wiring,
automatic execution, and Odinn sign-off remain pending.
