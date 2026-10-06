# FPS Target: Refresh Headroom Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo measures available refresh headroom against observed
FPS and identifies persistent collapse. It is lazy-loaded by the FPS-target
engine and fires only on the four declared triggers. It never applies a cap,
changes display policy, modifies files, or opens transport.

The turbo reports bounded headroom values, persistence counts, headless and
disabled-observation boundaries, and an immutable recommendation set for the
dedicated library boundary.

The paired dedicated library validates and merges headroom reports, derives
bounded interactive or headless observation plans, and wraps trigger evidence
in immutable envelopes. It exposes `mergeFpsRefreshHeadroomReports`,
`buildFpsRefreshHeadroomPlan`, `buildFpsRefreshHeadroomEnvelope`, and
`createFpsRefreshHeadroomLibrary` without importing or delegating to the turbo.
