# Process I/O: Contention Burst Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo measures bounded process I/O-wait contention bursts
for interactive and headless environments. It distinguishes sustained,
observed, stable, disabled, empty, and incomplete evidence and reports review
guidance without throttling or changing a process.

The turbo is lazy-loaded by the process-io engine and fires only on the
declared installation, facts, workload, and health triggers. It does not edit
files or open HTTP, API, REST, socket, or other transport paths.

The paired dedicated library validates bounded counts and rates, merges
contention reports with safety precedence, derives explicit observation plans,
and wraps trigger evidence in immutable envelopes.
