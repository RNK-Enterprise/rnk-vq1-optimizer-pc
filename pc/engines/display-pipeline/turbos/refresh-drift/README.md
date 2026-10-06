# Display Pipeline: Refresh Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo observes refresh-rate movement and bounded display
evidence. It is lazy-loaded by the display-pipeline engine and fires only on
the four declared triggers. It never changes refresh, resolution, HDR, VRR,
files, or transport.

The paired dedicated library validates and merges refresh-drift reports,
derives bounded interactive or headless observation plans, and wraps trigger
evidence in immutable envelopes. It exposes `mergeDisplayRefreshDriftReports`,
`buildDisplayRefreshDriftPlan`, `buildDisplayRefreshDriftEnvelope`, and
`createDisplayRefreshDriftLibrary` without importing or delegating to the turbo.
