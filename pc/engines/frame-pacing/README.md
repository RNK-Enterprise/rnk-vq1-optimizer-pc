# Frame Pacing Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies bounded frame-time variance, dropped-frame percentage,
FPS, and optional target-gap observations. It treats headless hosts as
no-display environments and keeps unknown display telemetry explicit.

It is analysis-only. It does not set FPS caps, change display settings,
modify files, or open transport.

The four dedicated libraries classify and merge bounded timing evidence,
derive interactive or headless observation plans, and emit immutable local
review envelopes without changing caps or display policy:

- `jitter-drift`: frame-time variance movement.
- `drop-budget`: normal, elevated, and critical dropped-frame pressure.
- `target-gap`: FPS shortfall against an explicit target.
- `cadence-stability`: frame-time movement and cadence drift.

The family regression is 8 suites and 36 tests at 100% statements, branches,
functions, and lines. All turbo and library source files remain below the
500-LOC cap.
