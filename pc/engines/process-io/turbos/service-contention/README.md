# Process I/O: Service Contention Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo isolates service-process I/O-wait pressure from other
processes across bounded system-facts samples. It distinguishes sustained and
observed service contention, clear service observations, missing service-role
evidence, disabled observation, empty process lists, and incomplete data.

The turbo is lazy-loaded by the process-io engine and fires only on the
declared installation, facts, workload, and health triggers. It does not
throttle, terminate, or edit files and does not open HTTP, API, REST, socket,
or other transport paths.
