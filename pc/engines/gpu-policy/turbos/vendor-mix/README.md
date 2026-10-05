# GPU Policy: Vendor Mix Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo classifies bounded GPU vendor composition as homogeneous, mixed, sustained mixed, incomplete, or vendor-specific. It is lazy-loaded by the GPU-policy catalog and fires only on the four declared GPU-policy triggers. It does not change drivers, files, GPU policy, network state, or transport.

The dedicated library validates turbo reports, merges bounded vendor evidence,
produces environment-aware observation plans, and emits immutable local
envelopes. It does not import or execute the turbo.
