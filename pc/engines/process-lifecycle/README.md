# Process Lifecycle Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine classifies running, sleeping, stopped, zombie, and unknown process
states, and reports bounded uptime and restart evidence. It keeps lifecycle
ownership visible instead of assuming the optimizer may intervene.

It is analysis-only. It does not terminate, restart, suspend, reparent,
modify files, or open transport.

The dedicated `library.js` classifies process states and restart evidence,
compares lifecycle snapshots, and emits immutable local review envelopes
without changing process state.

The four lazy-loaded turbo/library pairs are:

- `restart-burst`: bounded cumulative restart evidence.
- `zombie-persistence`: sustained and observed zombie-state evidence.
- `uptime-churn`: short-lived process uptime evidence.
- `state-coverage`: documented process-state coverage.

Each pair has a dedicated library, immutable report/envelope boundary, strict
trigger validation, headless-safe observation behavior, and its own changelog
and tests. No pair restarts, terminates, suspends, reparents, or otherwise
mutates processes, edits user files, or opens HTTP, API, REST, socket, or
other transport.
