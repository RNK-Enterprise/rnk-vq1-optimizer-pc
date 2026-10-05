# Process I/O Engine

Status: implementation complete locally; pending Odinn sign-off.

This engine aggregates bounded per-process read and write rates and maximum
I/O wait. It distinguishes normal, elevated, high, unknown, empty, and
observation-disabled states for interactive and headless hosts.

It is analysis-only. It does not change process priority, throttle I/O,
terminate processes, modify files, or open transport.

The dedicated `library.js` aggregates process I/O observations, compares
snapshots, and emits immutable local review envelopes without applying
throttles or process changes.
