# Display Pipeline: HDR Capability Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo observes HDR capability and state movement. It is
lazy-loaded by the display-pipeline engine and fires only on the four declared
triggers. It never enables or disables HDR, changes display policy, modifies
files, or opens transport.

The paired dedicated library validates and merges HDR-capability reports,
derives bounded interactive or headless observation plans, and wraps trigger
evidence in immutable envelopes. It exposes `mergeDisplayHdrCapabilityReports`,
`buildDisplayHdrCapabilityPlan`, `buildDisplayHdrCapabilityEnvelope`, and
`createDisplayHdrCapabilityLibrary` without importing or delegating to the turbo.
