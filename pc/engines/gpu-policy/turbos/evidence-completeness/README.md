# GPU Policy: Evidence Completeness Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo checks bounded vendor, model, and driver evidence completeness and detects missing-field drift across samples. It is lazy-loaded by the GPU-policy catalog and fires only on the four declared GPU-policy triggers. It does not change drivers, files, GPU policy, or transport.
