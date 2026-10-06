# GPU Memory: Capacity Skew Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo measures bounded VRAM capacity asymmetry across adapters and distinguishes balanced, observed-skew, and sustained-skew layouts. It is lazy-loaded by the GPU-memory catalog and fires only on the four declared GPU-memory triggers. It never changes allocation policy, drivers, files, or transport.

The dedicated library validates turbo reports, merges bounded capacity
evidence, produces environment-aware observation plans, and emits immutable
local envelopes. It does not import or execute the turbo.
