# Frame Pacing Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies bounded frame-time variance, dropped-frame percentage,
FPS, and optional target-gap observations. It treats headless hosts as
no-display environments and keeps unknown display telemetry explicit.

It is analysis-only. It does not set FPS caps, change display settings,
modify files, or open transport.

The dedicated `library.js` classifies bounded timing evidence, compares
snapshots, and emits immutable local review envelopes without changing caps or
display policy.
