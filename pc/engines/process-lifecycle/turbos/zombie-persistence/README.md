# Process Lifecycle: Zombie Persistence Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo measures bounded zombie-process persistence across
interactive and headless system-facts samples. It distinguishes sustained and
observed zombie evidence from clear, empty, and incomplete lifecycle data and
keeps ownership review separate from process mutation.

The turbo is lazy-loaded by the process-lifecycle engine and fires only on the
declared installation, facts, workload, and health triggers. It does not
terminate, reparent, edit files, or open HTTP, API, REST, socket, or other
transport paths.
