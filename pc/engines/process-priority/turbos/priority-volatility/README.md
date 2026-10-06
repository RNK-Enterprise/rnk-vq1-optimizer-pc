# Process Priority: Priority Volatility Turbo

Status: implementation complete locally; pending Odinn sign-off.

This analysis-only turbo compares bounded process priority, foreground, and
protection signatures. It reports stable, observed, and sustained state
volatility while preserving headless, empty-process, and incomplete-evidence
boundaries.

The turbo is lazy-loaded by the process-priority engine and fires only on the
declared installation, facts, workload, and health triggers. It does not
renice, suspend, terminate, edit files, or open HTTP, API, REST, socket, or
other transport paths.

The paired dedicated library validates bounded sample and process counts,
merges volatility evidence with safety precedence, derives explicit
observation plans, and wraps trigger evidence in immutable envelopes.
