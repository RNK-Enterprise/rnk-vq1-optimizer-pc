# Frame Pacing: Drop Budget Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo classifies bounded dropped-frame pressure into normal, elevated, and critical persistence bands with explicit headless and disabled-observation boundaries. It is lazy-loaded by the frame-pacing catalog and fires only on the four declared frame-pacing triggers. It never changes display policy, FPS caps, files, or transport.

The paired dedicated library validates and merges drop-budget reports, derives bounded interactive or headless observation plans, and wraps trigger evidence in immutable envelopes. It exposes `mergeFrameDropBudgetReports`, `buildFrameDropBudgetPlan`, `buildFrameDropBudgetEnvelope`, and `createFrameDropBudgetLibrary` without importing or delegating to the turbo.
