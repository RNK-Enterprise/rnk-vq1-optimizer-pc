# Process Priority: Unknown Label Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo measures undocumented process-priority labels across
bounded system-facts samples. It reports the latest and maximum unknown-label
rates, distinguishes observed from sustained evidence, and preserves
headless, empty-process, and unknown-environment boundaries.

The turbo is lazy-loaded by the process-priority engine and fires only on the
declared installation, facts, workload, and health triggers. It does not
rename, suspend, terminate, edit files, or open HTTP, API, REST, socket, or
other transport paths.
