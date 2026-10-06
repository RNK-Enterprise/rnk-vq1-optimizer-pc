# Process Lifecycle: Restart Burst Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo measures bounded cumulative restart evidence across
interactive and headless system-facts samples. It distinguishes sustained and
observed restart activity from stable, empty, and incomplete evidence without
restarting, terminating, suspending, or reparenting a process.

The turbo is lazy-loaded by the process-lifecycle engine and fires only on the
declared installation, facts, workload, and health triggers. It does not edit
files or open HTTP, API, REST, socket, or other transport paths.
