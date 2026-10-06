# GPU Memory: Occupancy Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo measures bounded VRAM occupancy movement, invalid counters, incomplete evidence, no-GPU posture, and disabled observation. It is lazy-loaded by the GPU-memory catalog and fires only on the four declared GPU-memory triggers. It never evicts resources, changes allocation policy, edits files, or opens transport.

The dedicated library validates turbo reports, merges bounded occupancy
evidence, produces environment-aware observation plans, and emits immutable
local envelopes. It does not import or execute the turbo.
