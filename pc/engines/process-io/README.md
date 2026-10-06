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

The four lazy-loaded turbo/library pairs are:

- `contention-burst`: bounded I/O-wait contention persistence.
- `read-write-skew`: aggregate read/write direction ratios.
- `service-contention`: service-role I/O-wait pressure.
- `observation-confidence`: per-process metric completeness.

Each pair has a dedicated library, immutable report/envelope boundary, strict
trigger validation, headless-safe observation behavior, and its own changelog
and tests. No pair throttles, terminates, or renices processes, edits user
files, or opens HTTP, API, REST, socket, or other transport.
