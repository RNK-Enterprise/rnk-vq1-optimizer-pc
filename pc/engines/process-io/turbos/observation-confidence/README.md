# Process I/O: Observation Confidence Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo measures completeness of per-process read, write, and
I/O-wait metrics across bounded system-facts samples. It distinguishes
sustained and observed low-confidence evidence from complete observations,
disabled observation, empty process lists, and unknown environments.

The turbo is lazy-loaded by the process-io engine and fires only on the
declared installation, facts, workload, and health triggers. It does not edit
files or open HTTP, API, REST, socket, or other transport paths.

The paired dedicated library validates bounded sample and process counts,
merges confidence reports with safety precedence, derives explicit observation
plans, and wraps trigger evidence in immutable envelopes.
