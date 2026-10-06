# Frame Pacing: Jitter Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo measures bounded frame-time variance movement and explicit headless, disabled-observation, and incomplete-evidence boundaries. It is lazy-loaded by the frame-pacing catalog and fires only on the four declared frame-pacing triggers. It never changes display policy, FPS caps, files, or transport.

The paired dedicated library validates and merges jitter-drift reports, derives bounded interactive or headless observation plans, and wraps trigger evidence in immutable envelopes. It exposes `mergeFrameJitterDriftReports`, `buildFrameJitterDriftPlan`, `buildFrameJitterDriftEnvelope`, and `createFrameJitterDriftLibrary` without importing or delegating to the turbo.
