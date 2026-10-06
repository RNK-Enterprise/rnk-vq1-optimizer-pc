# Process Priority: Priority Drift Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo compares bounded, normalized process-priority
signatures across system-facts samples. It accepts interactive and headless
environments, treats unknown environments or priority labels as incomplete,
and reports sustained or observed movement without changing process state.

The turbo is lazy-loaded by the process-priority engine and fires only on the
declared installation, facts, workload, and health triggers. It does not
renice, suspend, terminate, edit files, or open HTTP, API, REST, socket, or
other transport paths.
