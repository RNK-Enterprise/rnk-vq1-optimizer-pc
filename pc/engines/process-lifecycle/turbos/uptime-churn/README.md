# Process Lifecycle: Uptime Churn Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo measures bounded short-lived process uptime evidence
across interactive and headless system-facts samples. It distinguishes
sustained and observed churn from stable, empty, and incomplete uptime data
without restarting or terminating a process.

The turbo is lazy-loaded by the process-lifecycle engine and fires only on the
declared installation, facts, workload, and health triggers. It does not edit
files or open HTTP, API, REST, socket, or other transport paths.
