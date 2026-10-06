# FPS Target: Target Source Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo observes movement between user-owned, display-derived,
and measured FPS target provenance. It is lazy-loaded by the FPS-target engine
and fires only on the four declared triggers. It never applies a cap, changes
display policy, modifies files, or opens transport.

The turbo reports bounded source counts, transitions, comparison evidence,
headless and disabled-observation boundaries, and an immutable recommendation
set for the dedicated library boundary.

The paired dedicated library validates and merges source-drift reports, derives
bounded interactive or headless observation plans, and wraps trigger evidence
in immutable envelopes. It exposes `mergeFpsTargetSourceDriftReports`,
`buildFpsTargetSourceDriftPlan`, `buildFpsTargetSourceDriftEnvelope`, and
`createFpsTargetSourceDriftLibrary` without importing or delegating to the turbo.
