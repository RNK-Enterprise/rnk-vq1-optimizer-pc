# FPS Target: User Target Guard Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo audits explicit user FPS targets against documented
refresh evidence. It identifies preserved, over-refresh, no-display, and
incomplete-target states without rewriting the target or opening transport.

It is lazy-loaded by the FPS-target engine and fires only on the four declared
triggers. It never applies a cap, changes display policy, or modifies files.

The paired dedicated library validates and merges user-target guard reports,
derives bounded interactive or headless observation plans, and wraps trigger
evidence in immutable envelopes. It exposes `mergeFpsUserTargetGuardReports`,
`buildFpsUserTargetGuardPlan`, `buildFpsUserTargetGuardEnvelope`, and
`createFpsUserTargetGuardLibrary` without importing or delegating to the turbo.
