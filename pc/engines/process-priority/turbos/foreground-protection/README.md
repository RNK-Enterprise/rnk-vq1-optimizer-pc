# Process Priority: Foreground Protection Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo evaluates foreground process protection, elevated
foreground priority, and unprotected foreground work across bounded
system-facts samples. It separates sustained from observed elevation and
preserves incomplete and empty-process boundaries.

The turbo is lazy-loaded by the process-priority engine and fires only on the
declared installation, facts, workload, and health triggers. It does not
renice, suspend, terminate, edit files, or open HTTP, API, REST, socket, or
other transport paths.
