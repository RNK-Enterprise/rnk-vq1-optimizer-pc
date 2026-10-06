# Process I/O: Read-Write Skew Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo compares bounded aggregate read and write rates. It
identifies sustained or observed read/write skew, balanced I/O, disabled
observation, empty process lists, and incomplete evidence without applying a
throttle or changing process state.

The turbo is lazy-loaded by the process-io engine and fires only on the
declared installation, facts, workload, and health triggers. It does not edit
files or open HTTP, API, REST, socket, or other transport paths.

The paired dedicated library validates bounded direction counts and nullable
throughput metrics, merges skew reports with safety precedence, derives
explicit observation plans, and wraps trigger evidence in immutable
envelopes.
