# Process Lifecycle Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies running, sleeping, stopped, zombie, and unknown process
states, and reports bounded uptime and restart evidence. It keeps lifecycle
ownership visible instead of assuming the optimizer may intervene.

It is analysis-only. It does not terminate, restart, suspend, reparent,
modify files, or open transport.
